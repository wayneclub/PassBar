import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import {
  practiceAnswers,
  practiceSessions,
  userQuestionProgress,
} from '../db/schema';

export type QuestionStatus =
  | 'Unused'
  | 'Incorrect'
  | 'Marked'
  | 'Omitted'
  | 'Correct';
export type QuestionStatusCounts = Record<QuestionStatus, number>;

export const emptyQuestionStatusCounts: QuestionStatusCounts = {
  Unused: 0,
  Incorrect: 0,
  Marked: 0,
  Omitted: 0,
  Correct: 0,
};

export type QuestionStatusFilter = {
  Unused: boolean;
  Incorrect: boolean;
  Marked: boolean;
  Omitted: boolean;
  Correct: boolean;
};

@Injectable()
export class QuestionProgressService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getStatusCounts(
    userId: string,
    totalQuestions: number,
  ): Promise<QuestionStatusCounts> {
    const rows = await this.db
      .select({
        status: userQuestionProgress.status,
        isMarked: userQuestionProgress.isMarked,
      })
      .from(userQuestionProgress)
      .where(eq(userQuestionProgress.userId, userId));

    const counts = { ...emptyQuestionStatusCounts };
    rows.forEach((row) => {
      if (row.status === 'correct') counts.Correct += 1;
      if (row.status === 'incorrect') counts.Incorrect += 1;
      if (row.status === 'omitted') counts.Omitted += 1;
      if (row.isMarked) counts.Marked += 1;
    });
    counts.Unused = Math.max(totalQuestions - rows.length, 0);
    return counts;
  }

  async saveAnswerProgress(input: {
    userId: string;
    questionId: string;
    selectedChoice: string;
    correctAnswer: string;
    isCorrect: boolean;
    timeSpentSeconds?: number;
  }) {
    const existing = await this.db.query.userQuestionProgress.findFirst({
      where: and(
        eq(userQuestionProgress.userId, input.userId),
        eq(userQuestionProgress.questionId, input.questionId),
      ),
    });

    const existingTimesAnswered = existing?.timesAnswered ?? 0;
    const existingTimeSpent = existing?.timeSpentSeconds ?? 0;

    await this.db
      .insert(userQuestionProgress)
      .values({
        userId: input.userId,
        questionId: input.questionId,
        status: input.isCorrect ? 'correct' : 'incorrect',
        selectedChoice: input.selectedChoice,
        correctAnswer: input.correctAnswer,
        isCorrect: input.isCorrect,
        isMarked: existing?.isMarked ?? false,
        timesAnswered: existingTimesAnswered + 1,
        timeSpentSeconds: existingTimeSpent + (input.timeSpentSeconds ?? 0),
        lastSeenAt: new Date(),
        lastAnsweredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userQuestionProgress.userId, userQuestionProgress.questionId],
        set: {
          status: input.isCorrect ? 'correct' : 'incorrect',
          selectedChoice: input.selectedChoice,
          correctAnswer: input.correctAnswer,
          isCorrect: input.isCorrect,
          timesAnswered: existingTimesAnswered + 1,
          timeSpentSeconds: existingTimeSpent + (input.timeSpentSeconds ?? 0),
          lastSeenAt: new Date(),
          lastAnsweredAt: new Date(),
        },
      });
    return true;
  }

  async getQuestionAnswerStats(questionId: string) {
    const choicePercents: Partial<Record<'A' | 'B' | 'C' | 'D', number>> = {};

    const choiceResult = await this.db.execute(
      sql`select * from public.get_question_choice_stats(${questionId})`,
    );
    for (const row of choiceResult.rows as Array<{
      selected_choice: string;
      answer_percent: number;
    }>) {
      const choice = String(row.selected_choice ?? '').toUpperCase();
      if (
        choice === 'A' ||
        choice === 'B' ||
        choice === 'C' ||
        choice === 'D'
      ) {
        choicePercents[choice] = row.answer_percent ?? 0;
      }
    }

    const statsResult = await this.db.execute(
      sql`select * from public.get_question_answer_stats(${questionId})`,
    );
    const row = statsResult.rows[0] as
      | {
          total_answers: string | number;
          correct_answers: string | number;
          correct_percent: number | null;
        }
      | undefined;

    return {
      totalAnswers: row ? Number(row.total_answers) : 0,
      correctAnswers: row ? Number(row.correct_answers) : 0,
      correctPercent: row?.correct_percent ?? null,
      choicePercents,
    };
  }

  async getAllUserProgress(
    userId: string,
  ): Promise<Record<string, { status: string; isMarked: boolean }>> {
    const rows = await this.db
      .select({
        questionId: userQuestionProgress.questionId,
        status: userQuestionProgress.status,
        isMarked: userQuestionProgress.isMarked,
      })
      .from(userQuestionProgress)
      .where(eq(userQuestionProgress.userId, userId));

    return Object.fromEntries(
      rows.map((r) => [
        r.questionId,
        { status: r.status, isMarked: Boolean(r.isMarked) },
      ]),
    );
  }

  async filterQuestionIdsByStatus(
    userId: string,
    questionIds: string[],
    filters: QuestionStatusFilter,
  ): Promise<string[]> {
    const anyEnabled = Object.values(filters).some(Boolean);
    if (!anyEnabled) return questionIds;
    if (questionIds.length === 0) return [];

    const rows = await this.db
      .select({
        questionId: userQuestionProgress.questionId,
        status: userQuestionProgress.status,
        isMarked: userQuestionProgress.isMarked,
      })
      .from(userQuestionProgress)
      .where(
        and(
          eq(userQuestionProgress.userId, userId),
          inArray(userQuestionProgress.questionId, questionIds),
        ),
      );

    const progressMap = new Map(
      rows.map((r) => [
        r.questionId,
        { status: r.status, isMarked: Boolean(r.isMarked) },
      ]),
    );

    return questionIds.filter((id) => {
      const progress = progressMap.get(id);
      if (!progress) return filters.Unused;
      if (filters.Marked && progress.isMarked) return true;
      if (filters.Correct && progress.status === 'correct') return true;
      if (filters.Incorrect && progress.status === 'incorrect') return true;
      if (filters.Omitted && progress.status === 'omitted') return true;
      return false;
    });
  }

  async getMarkedQuestionIds(
    userId: string,
    questionIds: string[],
  ): Promise<string[]> {
    if (questionIds.length === 0) return [];
    const rows = await this.db
      .select({ questionId: userQuestionProgress.questionId })
      .from(userQuestionProgress)
      .where(
        and(
          eq(userQuestionProgress.userId, userId),
          eq(userQuestionProgress.isMarked, true),
          inArray(userQuestionProgress.questionId, questionIds),
        ),
      );
    return rows.map((r) => r.questionId);
  }

  async setQuestionMarked(input: {
    userId: string;
    questionId: string;
    isMarked: boolean;
  }) {
    const existing = await this.db.query.userQuestionProgress.findFirst({
      where: and(
        eq(userQuestionProgress.userId, input.userId),
        eq(userQuestionProgress.questionId, input.questionId),
      ),
    });

    await this.db
      .insert(userQuestionProgress)
      .values({
        userId: input.userId,
        questionId: input.questionId,
        status: existing?.status ?? 'omitted',
        selectedChoice: existing?.selectedChoice ?? null,
        correctAnswer: existing?.correctAnswer ?? null,
        isCorrect: existing?.isCorrect ?? false,
        isMarked: input.isMarked,
        timesAnswered: existing?.timesAnswered ?? 0,
        timeSpentSeconds: existing?.timeSpentSeconds ?? 0,
        firstSeenAt: existing?.firstSeenAt ?? new Date(),
        lastSeenAt: new Date(),
        lastAnsweredAt: existing?.lastAnsweredAt ?? null,
      })
      .onConflictDoUpdate({
        target: [userQuestionProgress.userId, userQuestionProgress.questionId],
        set: { isMarked: input.isMarked, lastSeenAt: new Date() },
      });
    return true;
  }

  async saveOmittedProgress(input: { userId: string; questionIds: string[] }) {
    if (input.questionIds.length === 0) return;

    const existingRows = await this.db
      .select({ questionId: userQuestionProgress.questionId })
      .from(userQuestionProgress)
      .where(
        and(
          eq(userQuestionProgress.userId, input.userId),
          inArray(userQuestionProgress.questionId, input.questionIds),
        ),
      );

    const existingIds = new Set(existingRows.map((r) => r.questionId));
    const newQuestionIds = input.questionIds.filter(
      (id) => !existingIds.has(id),
    );
    if (newQuestionIds.length === 0) return;

    await this.db.insert(userQuestionProgress).values(
      newQuestionIds.map((questionId) => ({
        userId: input.userId,
        questionId,
        status: 'omitted' as const,
        isCorrect: false,
        lastSeenAt: new Date(),
      })),
    );
  }

  async clearPracticeProgress(userId: string) {
    await this.db
      .delete(practiceAnswers)
      .where(eq(practiceAnswers.userId, userId));
    await this.db
      .delete(practiceSessions)
      .where(eq(practiceSessions.userId, userId));
    await this.db
      .delete(userQuestionProgress)
      .where(eq(userQuestionProgress.userId, userId));
    return true;
  }
}
