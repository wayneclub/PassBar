import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { questionItems, topicStudyProgress, topicStudyQuestionStates } from '../db/schema';

@Injectable()
export class TopicStudyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getProgressByUser(userId: string) {
    return this.db
      .select()
      .from(topicStudyProgress)
      .where(eq(topicStudyProgress.userId, userId));
  }

  async upsertProgress(input: {
    userId: string;
    chapterId: string;
    viewedCount: number;
    lastQuestionId: string | null;
    lastQuestionIndex: number;
  }) {
    await this.db
      .insert(topicStudyProgress)
      .values({
        userId: input.userId,
        chapterId: input.chapterId,
        viewedCount: input.viewedCount,
        lastQuestionId: input.lastQuestionId,
        lastQuestionIndex: input.lastQuestionIndex,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [topicStudyProgress.userId, topicStudyProgress.chapterId],
        set: {
          viewedCount: input.viewedCount,
          lastQuestionId: input.lastQuestionId,
          lastQuestionIndex: input.lastQuestionIndex,
          updatedAt: new Date(),
        },
      });
  }

  async deleteProgressForUser(userId: string, chapterIds?: string[]) {
    if (chapterIds?.length) {
      await this.db
        .delete(topicStudyProgress)
        .where(
          and(
            eq(topicStudyProgress.userId, userId),
            inArray(topicStudyProgress.chapterId, chapterIds),
          ),
        );
    } else {
      await this.db
        .delete(topicStudyProgress)
        .where(eq(topicStudyProgress.userId, userId));
    }
  }

  async getQuestionStates(userId: string, questionIds: string[]) {
    if (questionIds.length === 0) return {};
    const rows = await this.db
      .select({
        questionId: topicStudyQuestionStates.questionId,
        chapterId: topicStudyQuestionStates.chapterId,
        isLearned: topicStudyQuestionStates.isLearned,
        isMarked: topicStudyQuestionStates.isMarked,
      })
      .from(topicStudyQuestionStates)
      .where(
        and(
          eq(topicStudyQuestionStates.userId, userId),
          inArray(topicStudyQuestionStates.questionId, questionIds),
        ),
      );

    return Object.fromEntries(
      rows.map((r) => [
        r.questionId,
        { isLearned: r.isLearned, isMarked: r.isMarked },
      ]),
    );
  }

  async getMarkedQuestionIds(
    userId: string,
    questionIds?: string[],
  ): Promise<string[]> {
    const conditions = [
      eq(topicStudyQuestionStates.userId, userId),
      eq(topicStudyQuestionStates.isMarked, true),
    ];
    if (questionIds?.length)
      conditions.push(
        inArray(topicStudyQuestionStates.questionId, questionIds),
      );

    const rows = await this.db
      .select({ questionId: topicStudyQuestionStates.questionId })
      .from(topicStudyQuestionStates)
      .where(and(...conditions));
    return rows.map((r) => r.questionId);
  }

  async getMarkedChapterIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ chapterId: topicStudyQuestionStates.chapterId })
      .from(topicStudyQuestionStates)
      .where(
        and(
          eq(topicStudyQuestionStates.userId, userId),
          eq(topicStudyQuestionStates.isMarked, true),
        ),
      );
    return [
      ...new Set(
        rows.map((r) => r.chapterId).filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  async upsertQuestionState(input: {
    userId: string;
    questionId: string;
    chapterId?: string;
    isLearned?: boolean;
    isMarked?: boolean;
  }) {
    const existing = await this.db.query.topicStudyQuestionStates.findFirst({
      where: and(
        eq(topicStudyQuestionStates.userId, input.userId),
        eq(topicStudyQuestionStates.questionId, input.questionId),
      ),
    });

    await this.db
      .insert(topicStudyQuestionStates)
      .values({
        userId: input.userId,
        questionId: input.questionId,
        chapterId: input.chapterId ?? existing?.chapterId ?? null,
        isLearned: input.isLearned ?? existing?.isLearned ?? false,
        isMarked: input.isMarked ?? existing?.isMarked ?? false,
        firstSeenAt: existing?.firstSeenAt ?? new Date(),
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          topicStudyQuestionStates.userId,
          topicStudyQuestionStates.questionId,
        ],
        set: {
          chapterId: input.chapterId ?? existing?.chapterId ?? null,
          isLearned: input.isLearned ?? existing?.isLearned ?? false,
          isMarked: input.isMarked ?? existing?.isMarked ?? false,
          lastSeenAt: new Date(),
        },
      });
    return true;
  }

  async deleteQuestionStatesForChapter(userId: string, chapterId: string) {
    await this.db
      .delete(topicStudyQuestionStates)
      .where(
        and(
          eq(topicStudyQuestionStates.userId, userId),
          eq(topicStudyQuestionStates.chapterId, chapterId),
        ),
      );
  }

  async getChapterStateCounts(userId: string, ncbe?: boolean) {
    const conditions = [eq(topicStudyQuestionStates.userId, userId)];
    if (ncbe !== undefined) {
      conditions.push(eq(questionItems.isNcbe, ncbe));
    }
    const rows = await this.db
      .select({
        chapterId: topicStudyQuestionStates.chapterId,
        isLearned: topicStudyQuestionStates.isLearned,
        isMarked: topicStudyQuestionStates.isMarked,
      })
      .from(topicStudyQuestionStates)
      .innerJoin(
        questionItems,
        eq(questionItems.id, topicStudyQuestionStates.questionId),
      )
      .where(and(...conditions));

    const result: Record<
      string,
      { learnedCount: number; markedCount: number }
    > = {};
    rows.forEach((r) => {
      if (!r.chapterId) return;
      const existing = result[r.chapterId] ?? {
        learnedCount: 0,
        markedCount: 0,
      };
      result[r.chapterId] = {
        learnedCount: existing.learnedCount + (r.isLearned ? 1 : 0),
        markedCount: existing.markedCount + (r.isMarked ? 1 : 0),
      };
    });
    return result;
  }

  async clearBrowseProgress(userId: string) {
    await this.db
      .delete(topicStudyProgress)
      .where(eq(topicStudyProgress.userId, userId));
    await this.db
      .delete(topicStudyQuestionStates)
      .where(eq(topicStudyQuestionStates.userId, userId));
    return true;
  }
}
