import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { practiceSessions, practiceAnswers, questionItems } from '../db/schema';

type TestMode = 'Tutor' | 'Timed' | 'TopicStudy' | 'SimExam';

const STATUS_TO_DB: Record<string, 'in_progress' | 'completed' | 'suspended'> =
  {
    'In-Progress': 'in_progress',
    Completed: 'completed',
    Suspended: 'suspended',
  };
const STATUS_FROM_DB: Record<
  string,
  'In-Progress' | 'Completed' | 'Suspended'
> = {
  in_progress: 'In-Progress',
  completed: 'Completed',
  suspended: 'Suspended',
};

@Injectable()
export class PracticeSessionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async createSession(input: {
    userId: string;
    mode: TestMode;
    subjectNames: string[];
    chapterIds: string[];
    questionIds: string[];
  }) {
    const now = Date.now();
    const [created] = await this.db
      .insert(practiceSessions)
      .values({
        userId: input.userId,
        mode: input.mode,
        status: 'in_progress',
        subjectIds: input.subjectNames,
        chapterIds: input.chapterIds,
        questionCount: input.questionIds.length,
        startedAt: new Date(now),
        raw: {
          questionIds: input.questionIds,
          subjects: input.subjectNames,
          chapters: input.chapterIds,
          userAnswers: {},
          createdAt: now,
        },
      })
      .returning({ id: practiceSessions.id });

    return created?.id ?? null;
  }

  async saveAnswer(input: {
    sessionId: string;
    userId: string;
    questionId: string;
    selectedChoice: string;
    timeSpentSeconds?: number;
  }) {
    // 1. Verify session exists and belongs to this user (prevents IDOR / Session Tampering)
    const session = await this.db.query.practiceSessions.findFirst({
      where: and(
        eq(practiceSessions.id, input.sessionId),
        eq(practiceSessions.userId, input.userId),
      ),
    });
    if (!session) {
      throw new NotFoundException('Practice session not found');
    }

    // 2. Fetch the question to get the canonical correct answer (prevents client-side cheating)
    const question = await this.db.query.questionItems.findFirst({
      where: eq(questionItems.id, input.questionId),
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const correctAnswer = question.correctAnswer;
    const isCorrect = correctAnswer.toUpperCase() === input.selectedChoice.toUpperCase();

    // 3. Save or update the answer
    await this.db
      .insert(practiceAnswers)
      .values({
        sessionId: input.sessionId,
        userId: input.userId,
        questionId: input.questionId,
        selectedChoice: input.selectedChoice,
        correctAnswer: correctAnswer,
        isCorrect: isCorrect,
        timeSpentSeconds: input.timeSpentSeconds ?? null,
        answeredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [practiceAnswers.sessionId, practiceAnswers.questionId],
        set: {
          selectedChoice: input.selectedChoice,
          correctAnswer: correctAnswer,
          isCorrect: isCorrect,
          timeSpentSeconds: input.timeSpentSeconds ?? null,
          answeredAt: new Date(),
        },
      });
    return true;
  }

  async updateSession(input: {
    sessionId: string;
    userId: string;
    status: 'In-Progress' | 'Completed' | 'Suspended';
    timeSpent: number;
    questionIds: string[];
    subjects: string[];
    chapters: string[];
    userAnswers: Record<string, string>;
    createdAt: number;
  }) {
    await this.db
      .update(practiceSessions)
      .set({
        status: STATUS_TO_DB[input.status] ?? 'in_progress',
        completedAt: input.status === 'Completed' ? new Date() : null,
        totalTimeSeconds: input.timeSpent,
        raw: {
          questionIds: input.questionIds,
          subjects: input.subjects,
          chapters: input.chapters,
          userAnswers: input.userAnswers,
          createdAt: input.createdAt,
        },
      })
      .where(
        and(
          eq(practiceSessions.id, input.sessionId),
          eq(practiceSessions.userId, input.userId),
        ),
      );
  }

  async deleteSession(sessionId: string, userId: string) {
    await this.db
      .delete(practiceAnswers)
      .where(
        and(
          eq(practiceAnswers.sessionId, sessionId),
          eq(practiceAnswers.userId, userId),
        ),
      );
    await this.db
      .delete(practiceSessions)
      .where(
        and(
          eq(practiceSessions.id, sessionId),
          eq(practiceSessions.userId, userId),
        ),
      );
    return true;
  }

  async deleteAnswersForSession(sessionId: string, userId: string) {
    await this.db
      .delete(practiceAnswers)
      .where(
        and(
          eq(practiceAnswers.sessionId, sessionId),
          eq(practiceAnswers.userId, userId),
        ),
      );
    return true;
  }

  async getAnswersForSession(sessionId: string, userId: string) {
    return this.db
      .select({
        questionId: practiceAnswers.questionId,
        selectedChoice: practiceAnswers.selectedChoice,
        correctAnswer: practiceAnswers.correctAnswer,
        isCorrect: practiceAnswers.isCorrect,
        timeSpentSeconds: practiceAnswers.timeSpentSeconds,
        answeredAt: practiceAnswers.answeredAt,
      })
      .from(practiceAnswers)
      .where(
        and(
          eq(practiceAnswers.sessionId, sessionId),
          eq(practiceAnswers.userId, userId),
        ),
      )
      .orderBy(asc(practiceAnswers.answeredAt));
  }

  async getSession(
    sessionId: string,
    userId: string,
    options?: { answeredOnly?: boolean },
  ) {
    const [session, answerRows] = await Promise.all([
      this.db.query.practiceSessions.findFirst({
        where: and(
          eq(practiceSessions.id, sessionId),
          eq(practiceSessions.userId, userId),
        ),
      }),
      this.getAnswersForSession(sessionId, userId),
    ]);

    if (!session) return null;

    const raw = (session.raw ?? {}) as {
      questionIds?: string[];
      subjects?: string[];
      chapters?: string[];
      userAnswers?: Record<string, string>;
      createdAt?: number;
    };

    const answeredQuestionIds = answerRows
      .map((a) => a.questionId)
      .filter(Boolean);
    const rawAnsweredQuestionIds = Object.keys(raw.userAnswers ?? {});
    const questionIds =
      options?.answeredOnly && answeredQuestionIds.length > 0
        ? answeredQuestionIds
        : options?.answeredOnly && rawAnsweredQuestionIds.length > 0
          ? rawAnsweredQuestionIds
          : (raw.questionIds ?? []);

    const userAnswerChoices = Object.fromEntries(
      answerRows
        .filter((a) => a.selectedChoice)
        .map((a) => [a.questionId, a.selectedChoice.toUpperCase()]),
    );

    return {
      id: session.id,
      createdAt: raw.createdAt ?? session.startedAt?.getTime() ?? Date.now(),
      mode: session.mode,
      subjects: raw.subjects ?? session.subjectIds ?? [],
      chapters: raw.chapters ?? session.chapterIds ?? [],
      questionCount: session.questionCount ?? questionIds.length,
      questionIds,
      userAnswers: raw.userAnswers ?? {},
      userAnswerChoices,
      status: STATUS_FROM_DB[session.status] ?? 'In-Progress',
      timeSpent: session.totalTimeSeconds ?? 0,
    };
  }
}
