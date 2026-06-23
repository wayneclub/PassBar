import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, gte } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { practiceSessions, profiles } from '../db/schema';

@Injectable()
export class AdminService {
  constructor(@Inject(DB) private readonly db: Database) {}

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
      })
      .from(profiles)
      .orderBy(desc(profiles.createdAt));
  }

  async updateUserStatus(userId: string, status: 'pending' | 'approved' | 'rejected') {
    const [updated] = await this.db
      .update(profiles)
      .set({ status, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning({ id: profiles.id });
    return Boolean(updated);
  }

  async getPendingUsers(limit: number) {
    return this.db
      .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email, createdAt: profiles.createdAt })
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

    const [statusRows, activeRows, sessionRows, pendingList] = await Promise.all([
      this.db.select({ status: profiles.status }).from(profiles),
      this.db.select({ id: profiles.id }).from(profiles).where(gte(profiles.lastSeenAt, todayStart)),
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

    return {
      statusCounts: {
        total: statusRows.length,
        pending: statusRows.filter((r) => r.status === 'pending').length,
        approved: statusRows.filter((r) => r.status === 'approved').length,
        rejected: statusRows.filter((r) => r.status === 'rejected').length,
      },
      activeToday: activeRows.length,
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
