import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { userBadges } from '../db/schema';

export type BadgeCategory =
  | 'Consistency'
  | 'SpacedRepetition'
  | 'SubjectMastery';

export interface AchievementData {
  streakDays: number;
  maxDailyStudySeconds: number;
  chapterStats: Array<{ totalAttempts: number; lastAccuracy: number | null }>;
  subjectPerformance: Array<{
    name: string;
    score: number;
    correct: number;
    total: number;
  }>;
}

export interface Badge {
  id: string;
  category: BadgeCategory;
  criteria: (data: AchievementData) => boolean;
}

export const BADGES: Badge[] = [
  {
    id: 'disciplined_master',
    category: 'Consistency',
    criteria: (data) => data.streakDays >= 7,
  },
  {
    id: 'contempt_of_court',
    category: 'Consistency',
    criteria: (data) => data.streakDays >= 30,
  },
  {
    id: 'midnight_oil',
    category: 'Consistency',
    criteria: (data) => data.maxDailyStudySeconds >= 4 * 3600,
  },
  {
    id: 'hearsay_overruled',
    category: 'SpacedRepetition',
    criteria: (data) => data.chapterStats.some((c) => c.totalAttempts >= 3),
  },
  {
    id: 'res_judicata',
    category: 'SpacedRepetition',
    criteria: (data) =>
      data.chapterStats.some(
        (c) =>
          c.totalAttempts >= 2 &&
          c.lastAccuracy !== null &&
          c.lastAccuracy >= 85,
      ),
  },
  {
    id: 'reasonable_person',
    category: 'SubjectMastery',
    criteria: (data) => {
      const torts = data.subjectPerformance.find((s) => s.name === 'Torts');
      return Boolean(torts && torts.score >= 80 && torts.total >= 10);
    },
  },
  {
    id: 'lord_of_consideration',
    category: 'SubjectMastery',
    criteria: (data) => {
      const contracts = data.subjectPerformance.find(
        (s) => s.name === 'Contracts',
      );
      return Boolean(contracts && contracts.total >= 20);
    },
  },
];

@Injectable()
export class AchievementsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async evaluateUserBadges(userId: string, data: AchievementData) {
    const unlockedBadges = BADGES.filter((badge) => badge.criteria(data));
    const newBadgeIds = unlockedBadges.map((b) => b.id);

    if (newBadgeIds.length > 0) {
      const existing = await this.db
        .select({ badgeKey: userBadges.badgeKey })
        .from(userBadges)
        .where(eq(userBadges.userId, userId));
      const existingKeys = new Set(existing.map((b) => b.badgeKey));
      const toInsert = unlockedBadges
        .filter((b) => !existingKeys.has(b.id))
        .map((b) => ({ userId, badgeKey: b.id }));
      if (toInsert.length > 0) {
        await this.db.insert(userBadges).values(toInsert);
      }
    }

    return unlockedBadges.map((b) => b.id);
  }

  async fetchUserBadges(userId: string) {
    return this.db
      .select({
        badgeKey: userBadges.badgeKey,
        unlockedAt: userBadges.unlockedAt,
      })
      .from(userBadges)
      .where(eq(userBadges.userId, userId));
  }
}
