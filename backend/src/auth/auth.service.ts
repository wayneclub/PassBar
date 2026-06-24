import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { profiles, loginActivity } from '../db/schema';

const LOGIN_ACTIVITY_SYNC_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * PassBar no longer handles login itself — auth-service mints the `sub` and PassBar only
   * sees it on the first authenticated request. `profiles.id` has no local FK (the canonical
   * user record lives in auth-service's own DB), so this just needs to create the local
   * profile mirror on first sight of a given userId.
   *
   * `onConflictDoNothing` is scoped to the primary key only (not the `email` unique constraint):
   * a PK conflict means a harmless concurrent insert of the same row and is safe to ignore, but
   * an email conflict means some *other* row already owns this email (e.g. a pre-cutover account
   * with a different id) — that has to surface as an error, not silently return an empty profile.
   */
  async ensureProfile(
    userId: string,
    email: string | null,
    name: string | null,
    role: string,
    status: string,
  ) {
    let profile = await this.db.query.profiles.findFirst({
      where: eq(profiles.id, userId),
    });
    if (!profile) {
      let created;
      try {
        [created] = await this.db
          .insert(profiles)
          .values({
            id: userId,
            email,
            fullName: name,
            role,
            status,
            studySettings: {
              contentMode: 'english',
              textSize: 'medium',
              interfaceLanguage: 'en',
            },
          })
          .onConflictDoNothing({ target: profiles.id })
          .returning();
      } catch (err) {
        throw this.toEmailConflictError(err, email);
      }
      profile =
        created ??
        (await this.db.query.profiles.findFirst({
          where: eq(profiles.id, userId),
        }));
      if (!profile) {
        throw new ConflictException(
          `A profile already exists for email "${email}" under a different user id`,
        );
      }
    }

    // auth-service is the source of truth for role/status (memberships), so every request
    // re-syncs the local mirror instead of trusting whatever was stored at profile creation —
    // otherwise a role change in auth-service (e.g. admin -> member) never reaches PassBar's DB.
    // fullName only gets backfilled from the Google name when the user hasn't set their own
    // nickname yet (via PATCH /users/me/display-name) — a user-set nickname always wins and is
    // never overwritten by a later Google login.
    [profile] = await this.db
      .update(profiles)
      .set({
        role,
        status,
        lastSeenAt: new Date(),
        ...(!profile.fullName && name ? { fullName: name } : {}),
      })
      .where(eq(profiles.id, userId))
      .returning();

    // Login history (ip/device/last login/logout) lives in auth-service's sessions table —
    // this just pulls a cached, business-friendly summary for PassBar's own admin stats.
    // Failures here must never break the request that's piggybacking the sync on.
    this.syncLoginActivity(userId).catch((err) =>
      this.logger.warn(`syncLoginActivity failed for ${userId}: ${err}`),
    );

    // There's no avatar upload feature in PassBar, so the Google avatar is the only source —
    // unlike fullName, it's safe to always overwrite rather than backfill-once.
    if (!profile.avatarUrl) {
      this.syncAvatar(userId).catch((err) =>
        this.logger.warn(`syncAvatar failed for ${userId}: ${err}`),
      );
    }

    return profile;
  }

  /** Pulls the Google avatar from auth-service and backfills `profiles.avatar_url`. Only
   * called when missing (see ensureProfile) since this piggybacks on every authenticated
   * request and must stay cheap. */
  private async syncAvatar(userId: string): Promise<void> {
    const authServiceUrl = this.config.get<string>('AUTH_SERVICE_URL');
    const serviceSecret = this.config.get<string>('SERVICE_SECRET');
    if (!authServiceUrl || !serviceSecret) return;

    const res = await fetch(
      `${authServiceUrl}/auth/internal/avatar?userId=${userId}`,
      { headers: { Authorization: `Bearer ${serviceSecret}` } },
    );
    if (!res.ok) {
      throw new Error(`auth-service responded ${res.status}`);
    }

    const data = (await res.json()) as { image: string | null } | null;
    if (!data?.image) return;

    await this.db
      .update(profiles)
      .set({ avatarUrl: data.image })
      .where(eq(profiles.id, userId));
  }

  /** Pulls recent session history from auth-service and caches a summary in `login_activity`.
   * Skipped if the cache was refreshed within LOGIN_ACTIVITY_SYNC_INTERVAL_MS — this runs on
   * every authenticated request via ensureProfile, so it must stay cheap. */
  private async syncLoginActivity(userId: string): Promise<void> {
    const cached = await this.db.query.loginActivity.findFirst({
      where: eq(loginActivity.userId, userId),
    });
    if (
      cached?.syncedAt &&
      Date.now() - cached.syncedAt.getTime() < LOGIN_ACTIVITY_SYNC_INTERVAL_MS
    ) {
      return;
    }

    const authServiceUrl = this.config.get<string>('AUTH_SERVICE_URL');
    const serviceSecret = this.config.get<string>('SERVICE_SECRET');
    if (!authServiceUrl || !serviceSecret) return;

    const res = await fetch(
      `${authServiceUrl}/auth/internal/sessions?userId=${userId}&limit=5`,
      { headers: { Authorization: `Bearer ${serviceSecret}` } },
    );
    if (!res.ok) {
      throw new Error(`auth-service responded ${res.status}`);
    }

    const data = (await res.json()) as {
      sessions: Array<{
        createdAt: string;
        revokedAt: string | null;
        ip: string | null;
        userAgent: string | null;
      }>;
      loginCount: number;
    };

    const latest = data.sessions[0];
    const lastLogout = data.sessions.find((s) => s.revokedAt)?.revokedAt;

    await this.db
      .insert(loginActivity)
      .values({
        userId,
        loginCount: data.loginCount,
        lastLoginAt: latest ? new Date(latest.createdAt) : null,
        lastLogoutAt: lastLogout ? new Date(lastLogout) : null,
        lastIp: latest?.ip ?? null,
        lastDevice: latest?.userAgent ?? null,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: loginActivity.userId,
        set: {
          loginCount: data.loginCount,
          lastLoginAt: latest ? new Date(latest.createdAt) : null,
          lastLogoutAt: lastLogout ? new Date(lastLogout) : null,
          lastIp: latest?.ip ?? null,
          lastDevice: latest?.userAgent ?? null,
          syncedAt: new Date(),
        },
      });
  }

  /** Postgres unique_violation (23505) on the email column means a different row already owns it. Drizzle wraps the pg error inside `cause`, so check both. */
  private toEmailConflictError(err: unknown, email: string | null): Error {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined;
    const causeCode =
      err && typeof err === 'object' && 'cause' in err
        ? (err as { cause?: { code?: unknown } }).cause?.code
        : undefined;
    if (code === '23505' || causeCode === '23505') {
      return new ConflictException(
        `A profile already exists for email "${email}" under a different user id`,
      );
    }
    return err as Error;
  }

  /** Long-lived opaque token scoped only to the calendar feed — not a full session JWT. */
  issueCalendarToken(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, purpose: 'calendar' },
      { expiresIn: '5y' },
    );
  }

  verifyCalendarToken(token: string): string | null {
    try {
      const decoded = this.jwtService.verify<{ sub: string; purpose: string }>(
        token,
      );
      return decoded.purpose === 'calendar' ? decoded.sub : null;
    } catch {
      return null;
    }
  }

  async getProfile(userId: string) {
    return this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
  }
}
