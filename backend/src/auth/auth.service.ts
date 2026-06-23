import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { users, profiles } from '../db/schema';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * PassBar no longer handles login itself — auth-service mints the `sub` and PassBar only
   * sees it on the first authenticated request. `profiles.id` has an FK onto PassBar's own
   * `users.id`, so a local mirror row has to exist there first or the profile insert below
   * would violate that constraint.
   *
   * `onConflictDoNothing` is scoped to the primary key only (not the `email` unique constraint):
   * a PK conflict means a harmless concurrent insert of the same row and is safe to ignore, but
   * an email conflict means some *other* row already owns this email (e.g. a pre-cutover account
   * with a different id) — that has to surface as an error, not silently return an empty profile.
   */
  async ensureProfile(
    userId: string,
    email: string | null,
    role: string,
    status: string,
  ) {
    const existingUser = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!existingUser) {
      try {
        await this.db
          .insert(users)
          .values({ id: userId, email })
          .onConflictDoNothing({ target: users.id });
      } catch (err) {
        throw this.toEmailConflictError(err, email);
      }
    }

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
    [profile] = await this.db
      .update(profiles)
      .set({ role, status, lastSeenAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning();
    return profile;
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
