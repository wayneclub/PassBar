import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { count, desc, eq, gte } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { loginActivity, practiceSessions, profiles } from '../db/schema';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async listUsers() {
    return this.db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        role: profiles.role,
        status: profiles.status,
        lastSeenAt: profiles.lastSeenAt,
        createdAt: profiles.createdAt,
        // From auth-service's sessions table, cached in login_activity (see auth.service.ts
        // syncLoginActivity) — lastSeenAt above is "last request", this is "last real login".
        loginCount: loginActivity.loginCount,
        lastLoginAt: loginActivity.lastLoginAt,
        lastLogoutAt: loginActivity.lastLogoutAt,
      })
      .from(profiles)
      .leftJoin(loginActivity, eq(loginActivity.userId, profiles.id))
      .orderBy(desc(profiles.createdAt));
  }

  async updateUserStatus(
    userId: string,
    status: 'pending' | 'approved' | 'rejected',
  ) {
    // auth-service owns the real membership status — PassBar's `profiles.status` is only a
    // mirror that every login re-syncs from the auth-service JWT claims (see auth.service.ts
    // ensureProfile). Updating the mirror without also updating auth-service means the next
    // login overwrites the approval straight back to 'pending'.
    await this.setAuthServiceMembershipStatus(userId, status);

    const [updated] = await this.db
      .update(profiles)
      .set({ status, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning({ id: profiles.id });
    return Boolean(updated);
  }

  private async setAuthServiceMembershipStatus(
    userId: string,
    status: 'pending' | 'approved' | 'rejected',
  ) {
    const authServiceUrl = this.config.getOrThrow<string>('AUTH_SERVICE_URL');
    const serviceSecret = this.config.getOrThrow<string>('SERVICE_SECRET');

    const res = await fetch(
      `${authServiceUrl}/auth/internal/memberships/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceSecret}`,
        },
        body: JSON.stringify({ userId, product: 'passbar', status }),
      },
    );
    if (!res.ok) {
      throw new InternalServerErrorException(
        `auth-service rejected membership status update (${res.status})`,
      );
    }
  }

  /** Live login history for one user, straight from auth-service's sessions table — unlike
   * `login_activity` (a lazily-refreshed cache of just the latest entry), this is the full
   * recent list and always current. Used by the admin "view login history" action. */
  async getLoginHistory(userId: string, limit = 20) {
    const authServiceUrl = this.config.getOrThrow<string>('AUTH_SERVICE_URL');
    const serviceSecret = this.config.getOrThrow<string>('SERVICE_SECRET');
    const safeLimit = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), 100)
      : 20;
    const url = new URL('/auth/internal/sessions', authServiceUrl);
    url.searchParams.set('userId', userId);
    url.searchParams.set('limit', String(safeLimit));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${serviceSecret}` },
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `auth-service rejected login history lookup (${res.status})`,
      );
    }
    return res.json() as Promise<{
      sessions: Array<{
        id: string;
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
        ip: string | null;
        userAgent: string | null;
      }>;
      loginCount: number;
    }>;
  }

  async getPendingUsers(limit: number) {
    return this.db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.status, 'pending'))
      .orderBy(desc(profiles.createdAt))
      .limit(limit);
  }

  async getDashboardSummary(sinceDays: number) {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [statusRows, activeCountRows, sessionRows, pendingList] =
      await Promise.all([
        this.db
          .select({
            status: profiles.status,
            count: count(),
          })
          .from(profiles)
          .groupBy(profiles.status),
        this.db
          .select({ value: count() })
          .from(profiles)
          .where(gte(profiles.lastSeenAt, todayStart)),
        this.db
          .select({
            startedAt: practiceSessions.startedAt,
            questionCount: practiceSessions.questionCount,
            status: practiceSessions.status,
            userAgent: practiceSessions.userAgent,
            completedAt: practiceSessions.completedAt,
          })
          .from(practiceSessions)
          .where(gte(practiceSessions.startedAt, since))
          .orderBy(practiceSessions.startedAt),
        this.getPendingUsers(5),
      ]);

    const statusCounts = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    statusRows.forEach((row) => {
      const cnt = Number(row.count ?? 0);
      statusCounts.total += cnt;
      if (row.status === 'pending') statusCounts.pending = cnt;
      else if (row.status === 'approved') statusCounts.approved = cnt;
      else if (row.status === 'rejected') statusCounts.rejected = cnt;
    });

    return {
      statusCounts,
      activeToday: Number(activeCountRows[0]?.value ?? 0),
      sessions: sessionRows.map((s) => ({
        startedAt: s.startedAt ? s.startedAt.toISOString() : null,
        questionCount: s.questionCount,
        status: s.status,
        userAgent: s.userAgent,
        completedAt: s.completedAt ? s.completedAt.toISOString() : null,
      })),
      pendingUsers: pendingList.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        createdAt: u.createdAt ? u.createdAt.toISOString() : null,
      })),
    };
  }
}
