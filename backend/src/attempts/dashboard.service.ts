import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import {
  chapters,
  practiceAnswers,
  practiceSessions,
  profiles,
  questionChapterCounts,
  questionItems,
  questions,
  userConceptMastery,
  userQuestionProgress,
} from '../db/schema';

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Aggregates everything the dashboard page needs in a single round-trip. */
  async getDashboardStats(userId: string) {
    const todayStart = startOfLocalDay(new Date());
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      subjectCounts,
      progressRows,
      attemptsCountRows,
      chapterAnswerRows,
      todaySessions,
      weeklySessions,
    ] = await Promise.all([
      this.db
        .select({
          subject: questionChapterCounts.subject,
          count: questionChapterCounts.count,
        })
        .from(questionChapterCounts),
      this.db
        .select({
          questionId: userQuestionProgress.questionId,
          status: userQuestionProgress.status,
          isCorrect: userQuestionProgress.isCorrect,
          timeSpentSeconds: userQuestionProgress.timeSpentSeconds,
          lastAnsweredAt: userQuestionProgress.lastAnsweredAt,
          chapterId: chapters.id,
          chapterName: chapters.chapter,
          chapterSubject: chapters.subject,
        })
        .from(userQuestionProgress)
        .innerJoin(
          questionItems,
          eq(questionItems.id, userQuestionProgress.questionId),
        )
        .innerJoin(chapters, eq(chapters.id, questionItems.chapterId))
        .where(eq(userQuestionProgress.userId, userId)),
      this.db
        .select({ value: count() })
        .from(practiceAnswers)
        .where(eq(practiceAnswers.userId, userId)),
      this.db
        .select({
          questionId: practiceAnswers.questionId,
          isCorrect: practiceAnswers.isCorrect,
          timeSpentSeconds: practiceAnswers.timeSpentSeconds,
          confidence: practiceAnswers.confidence,
          answeredAt: practiceAnswers.answeredAt,
          chapterId: chapters.id,
          chapterName: chapters.chapter,
          chapterSubject: chapters.subject,
        })
        .from(practiceAnswers)
        .innerJoin(
          questionItems,
          eq(questionItems.id, practiceAnswers.questionId),
        )
        .innerJoin(chapters, eq(chapters.id, questionItems.chapterId))
        .where(eq(practiceAnswers.userId, userId)),
      this.db
        .select({
          startedAt: practiceSessions.startedAt,
          completedAt: practiceSessions.completedAt,
          totalTimeSeconds: practiceSessions.totalTimeSeconds,
          status: practiceSessions.status,
        })
        .from(practiceSessions)
        .where(
          and(
            eq(practiceSessions.userId, userId),
            gte(practiceSessions.startedAt, todayStart),
          ),
        ),
      this.db
        .select({
          startedAt: practiceSessions.startedAt,
          completedAt: practiceSessions.completedAt,
          totalTimeSeconds: practiceSessions.totalTimeSeconds,
          status: practiceSessions.status,
        })
        .from(practiceSessions)
        .where(
          and(
            eq(practiceSessions.userId, userId),
            gte(practiceSessions.startedAt, weekAgo),
          ),
        ),
    ]);

    const subjectMap = new Map<string, number>();
    subjectCounts.forEach((row) =>
      subjectMap.set(
        row.subject,
        (subjectMap.get(row.subject) ?? 0) + (row.count ?? 0),
      ),
    );
    const totalQuestions = Array.from(subjectMap.values()).reduce(
      (sum, c) => sum + c,
      0,
    );

    const answers = progressRows.filter(
      (r) => r.status === 'correct' || r.status === 'incorrect',
    );
    const solvedQuestions = answers.length;
    const correctAnswers = answers.filter((a) => a.isCorrect).length;
    const mastery =
      solvedQuestions > 0 ? (correctAnswers / solvedQuestions) * 100 : 0;

    const todayStartMs = todayStart.getTime();
    const solvedToday = answers.filter(
      (a) => a.lastAnsweredAt && a.lastAnsweredAt.getTime() >= todayStartMs,
    ).length;

    const todayTimeSeconds = todaySessions.reduce(
      (sum, s) => sum + (s.totalTimeSeconds ?? 0),
      0,
    );
    const weeklyStudyTimeSeconds = weeklySessions.reduce(
      (sum, s) => sum + (s.totalTimeSeconds ?? 0),
      0,
    );

    const answeredDayKeys = new Set(
      answers
        .filter((a) => a.lastAnsweredAt)
        .map((a) =>
          startOfLocalDay(a.lastAnsweredAt!).toISOString().slice(0, 10),
        ),
    );
    let streakDays = 0;
    const cursor = startOfLocalDay(new Date());
    while (answeredDayKeys.has(cursor.toISOString().slice(0, 10))) {
      streakDays += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    const sortedDays = Array.from(answeredDayKeys).sort();
    let bestStreak = 0;
    let running = 0;
    let prevDay: Date | null = null;
    for (const dayKey of sortedDays) {
      const day = new Date(dayKey);
      if (
        prevDay &&
        Math.round(
          (day.getTime() - prevDay.getTime()) / (1000 * 60 * 60 * 24),
        ) === 1
      ) {
        running += 1;
      } else {
        running = 1;
      }
      bestStreak = Math.max(bestStreak, running);
      prevDay = day;
    }

    const subjectPerformanceMap = new Map<
      string,
      { correct: number; total: number }
    >();
    answers.forEach((row) => {
      const subj = row.chapterSubject;
      if (!subj) return;
      const existing = subjectPerformanceMap.get(subj) ?? {
        correct: 0,
        total: 0,
      };
      existing.total += 1;
      if (row.isCorrect) existing.correct += 1;
      subjectPerformanceMap.set(subj, existing);
    });
    const subjectPerformance = Array.from(subjectPerformanceMap.entries()).map(
      ([name, s]) => ({
        name,
        score: s.total > 0 ? (s.correct / s.total) * 100 : 0,
        correct: s.correct,
        total: s.total,
      }),
    );

    const dailyCounts: Record<string, number> = {};
    const dailyChapterCounts: Record<string, Record<string, number>> = {};
    answers.forEach((row) => {
      if (!row.lastAnsweredAt) return;
      const dayKey = startOfLocalDay(row.lastAnsweredAt)
        .toISOString()
        .slice(0, 10);
      dailyCounts[dayKey] = (dailyCounts[dayKey] ?? 0) + 1;
      if (row.chapterId) {
        dailyChapterCounts[dayKey] = dailyChapterCounts[dayKey] ?? {};
        dailyChapterCounts[dayKey][row.chapterId] =
          (dailyChapterCounts[dayKey][row.chapterId] ?? 0) + 1;
      }
    });

    const recentAnswers = answers
      .filter((a) => a.lastAnsweredAt)
      .sort((a, b) => b.lastAnsweredAt!.getTime() - a.lastAnsweredAt!.getTime())
      .slice(0, 20);
    const recentAccuracy =
      recentAnswers.length > 0
        ? Math.round(
            (recentAnswers.filter((a) => a.isCorrect).length /
              recentAnswers.length) *
              100,
          )
        : null;
    const incorrectCount = answers.filter(
      (a) => a.status === 'incorrect',
    ).length;

    const totalAttempts = attemptsCountRows[0]?.value ?? 0;
    const avgSecondsPerQuestion =
      totalAttempts > 0
        ? Math.round(
            chapterAnswerRows.reduce(
              (s, a) => s + (a.timeSpentSeconds ?? 0),
              0,
            ) / totalAttempts,
          )
        : 0;

    const chapterStatsMap = new Map<
      string,
      {
        chapterId: string;
        chapterName: string;
        subject: string;
        attempts: number;
        correct: number;
        lastAttemptAt: string;
        totalTimeSeconds: number;
        timedAttempts: number;
      }
    >();
    chapterAnswerRows.forEach((row) => {
      if (!row.chapterId || !row.answeredAt) return;
      const answeredAtIso = row.answeredAt.toISOString();
      const existing = chapterStatsMap.get(row.chapterId) ?? {
        chapterId: row.chapterId,
        chapterName: row.chapterName ?? row.chapterId,
        subject: row.chapterSubject ?? 'Uncategorized',
        attempts: 0,
        correct: 0,
        lastAttemptAt: answeredAtIso,
        totalTimeSeconds: 0,
        timedAttempts: 0,
      };
      existing.attempts += 1;
      if (row.isCorrect) existing.correct += 1;
      existing.totalTimeSeconds += row.timeSpentSeconds ?? 0;
      if ((row.timeSpentSeconds ?? 0) > 0) existing.timedAttempts += 1;
      if (answeredAtIso > existing.lastAttemptAt)
        existing.lastAttemptAt = answeredAtIso;
      chapterStatsMap.set(row.chapterId, existing);
    });
    const chapterStats = Array.from(chapterStatsMap.values()).map((c) => ({
      chapterId: c.chapterId,
      chapterName: c.chapterName,
      subject: c.subject,
      attempts: c.attempts,
      correct: c.correct,
      lastAttemptAt: c.lastAttemptAt,
      totalAttempts: c.attempts,
      lastAccuracy:
        c.attempts > 0 ? Math.round((c.correct / c.attempts) * 100) : null,
    }));

    return {
      totalQuestions,
      solvedQuestions,
      practiceAttempts: totalAttempts,
      solvedToday,
      mastery,
      streakDays,
      timeTodaySeconds: todayTimeSeconds,
      subjectPerformance,
      dailyCounts,
      dailyChapterCounts,
      recentAccuracy,
      incorrectCount,
      weeklyStudyTimeSeconds,
      bestStreak,
      avgSecondsPerQuestion,
      chapterStats,
    };
  }

  /** Aggregates the profile page's stats + data needed for achievement evaluation. */
  async getProfileStats(userId: string) {
    const [progressRows, sessions, profile] = await Promise.all([
      this.db
        .select({
          isCorrect: userQuestionProgress.isCorrect,
          lastAnsweredAt: userQuestionProgress.lastAnsweredAt,
          status: userQuestionProgress.status,
          chapterSubject: chapters.subject,
        })
        .from(userQuestionProgress)
        .innerJoin(
          questionItems,
          eq(questionItems.id, userQuestionProgress.questionId),
        )
        .innerJoin(chapters, eq(chapters.id, questionItems.chapterId))
        .where(
          and(
            eq(userQuestionProgress.userId, userId),
            inArray(userQuestionProgress.status, ['correct', 'incorrect']),
          ),
        ),
      this.db
        .select({
          startedAt: practiceSessions.startedAt,
          totalTimeSeconds: practiceSessions.totalTimeSeconds,
        })
        .from(practiceSessions)
        .where(eq(practiceSessions.userId, userId)),
      this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) }),
    ]);

    const totalSolved = progressRows.length;

    const answeredDayKeys = new Set(
      progressRows
        .filter((r) => r.lastAnsweredAt)
        .map((r) =>
          startOfLocalDay(r.lastAnsweredAt!).toISOString().slice(0, 10),
        ),
    );
    let streak = 0;
    const cursor = startOfLocalDay(new Date());
    while (answeredDayKeys.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    const dailyStudySeconds = new Map<string, number>();
    sessions.forEach((session) => {
      if (!session.startedAt) return;
      const dayKey = startOfLocalDay(session.startedAt)
        .toISOString()
        .slice(0, 10);
      dailyStudySeconds.set(
        dayKey,
        (dailyStudySeconds.get(dayKey) ?? 0) + (session.totalTimeSeconds ?? 0),
      );
    });
    const maxDailyStudySeconds = Math.max(0, ...dailyStudySeconds.values());

    const subjectStats = new Map<string, { correct: number; total: number }>();
    progressRows.forEach((row) => {
      const subj = row.chapterSubject;
      if (!subj) return;
      const existing = subjectStats.get(subj) ?? { correct: 0, total: 0 };
      existing.total += 1;
      if (row.isCorrect) existing.correct += 1;
      subjectStats.set(subj, existing);
    });
    const subjectPerformance = Array.from(subjectStats.entries()).map(
      ([name, s]) => ({
        name,
        score: s.total > 0 ? (s.correct / s.total) * 100 : 0,
        correct: s.correct,
        total: s.total,
      }),
    );

    return {
      totalSolved,
      streakDays: streak,
      maxDailyStudySeconds,
      subjectPerformance,
      chapterStats: [] as Array<{
        totalAttempts: number;
        lastAccuracy: number | null;
      }>,
      joinDate: profile?.createdAt ? profile.createdAt.toISOString() : null,
    };
  }

  /** Aggregates performance-page data: full answer history + concept mastery + question metadata. */
  async getPerformanceData(userId: string) {
    const [answers, conceptMastery] = await Promise.all([
      this.db
        .select({
          questionId: practiceAnswers.questionId,
          isCorrect: practiceAnswers.isCorrect,
          answeredAt: practiceAnswers.answeredAt,
          timeSpentSeconds: practiceAnswers.timeSpentSeconds,
          confidence: practiceAnswers.confidence,
          changedAnswer: practiceAnswers.changedAnswer,
          errorType: practiceAnswers.errorType,
          selectedChoice: practiceAnswers.selectedChoice,
          correctAnswer: practiceAnswers.correctAnswer,
        })
        .from(practiceAnswers)
        .where(eq(practiceAnswers.userId, userId))
        .orderBy(practiceAnswers.answeredAt)
        .limit(5000),
      this.db
        .select()
        .from(userConceptMastery)
        .where(eq(userConceptMastery.userId, userId)),
    ]);

    const questionIds = [...new Set(answers.map((a) => a.questionId))];
    const metaRows =
      questionIds.length > 0
        ? await this.db
            .select({
              id: questions.id,
              subject: questions.subject,
              chapterId: questions.chapterId,
              chapterName: questions.chapterName,
              topic: questions.topic,
              microConcept: questions.microConcept,
              trapType: questions.trapType,
              trapTypeIsNew: questions.trapTypeIsNew,
              skillTested: questions.skillTested,
              keywordMeta: questions.keywordMeta,
              highlightMeta: questions.highlightMeta,
            })
            .from(questions)
            .where(inArray(questions.id, questionIds))
        : [];

    return {
      answers: answers.map((a) => ({
        questionId: a.questionId,
        isCorrect: a.isCorrect,
        answeredAt: a.answeredAt ? a.answeredAt.toISOString() : null,
        timeSpentSeconds: a.timeSpentSeconds,
        confidence: a.confidence,
        changedAnswer: a.changedAnswer,
        errorType: a.errorType,
        selectedChoice: a.selectedChoice,
        correctAnswer: a.correctAnswer,
      })),
      conceptMastery,
      metadata: metaRows,
    };
  }

  /** Paginated practice-session history for the review page, with optional date-range filter. */
  async getReviewSessions(
    userId: string,
    options: { page: number; pageSize: number; since?: Date },
  ) {
    const conditions = [
      eq(practiceSessions.userId, userId),
      ne(practiceSessions.mode, 'TopicStudy'),
    ];
    if (options.since)
      conditions.push(gte(practiceSessions.startedAt, options.since));

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: practiceSessions.id,
          mode: practiceSessions.mode,
          status: practiceSessions.status,
          subjectIds: practiceSessions.subjectIds,
          chapterIds: practiceSessions.chapterIds,
          questionCount: practiceSessions.questionCount,
          startedAt: practiceSessions.startedAt,
          completedAt: practiceSessions.completedAt,
          totalTimeSeconds: practiceSessions.totalTimeSeconds,
          answeredCount: practiceSessions.answeredCount,
          correctCount: practiceSessions.correctCount,
        })
        .from(practiceSessions)
        .where(and(...conditions))
        .orderBy(desc(practiceSessions.startedAt))
        .limit(options.pageSize)
        .offset(options.page * options.pageSize),
      this.db
        .select({ value: count() })
        .from(practiceSessions)
        .where(and(...conditions)),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        mode: r.mode,
        status: r.status,
        subjectIds: r.subjectIds,
        chapterIds: r.chapterIds,
        questionCount: r.questionCount,
        startedAt: r.startedAt ? r.startedAt.toISOString() : null,
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        totalTimeSeconds: r.totalTimeSeconds,
        answeredCount: r.answeredCount,
        correctCount: r.correctCount,
      })),
      totalCount: totalRows[0]?.value ?? 0,
    };
  }

  /** Lightweight subject/chapter id list for review-page filter chips (no date filter; whole history). */
  async getReviewFilterOptions(userId: string) {
    const rows = await this.db
      .select({
        subjectIds: practiceSessions.subjectIds,
        chapterIds: practiceSessions.chapterIds,
      })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          ne(practiceSessions.mode, 'TopicStudy'),
        ),
      );

    return rows.map((r) => ({
      subjectIds: r.subjectIds ?? [],
      chapterIds: r.chapterIds ?? [],
    }));
  }
}
