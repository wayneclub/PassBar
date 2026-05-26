import { supabase } from './supabase';
import type { TestMode, TestSession } from './types';

type PracticeSessionStatus = 'in_progress' | 'completed' | 'suspended';

type PracticeSessionRaw = {
  questionIds?: string[];
  subjects?: string[];
  chapters?: string[];
  userAnswers?: Record<string, string>;
  createdAt?: number;
};

export type PracticeAnswerRecord = {
  question_id: string;
  selected_choice: string | null;
  correct_answer: string | null;
  is_correct: boolean | null;
  time_spent_seconds: number | null;
  answered_at: string | null;
};

export function isUuid(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export async function createPracticeSessionRecord(input: {
  userId: string;
  mode: TestMode;
  subjectNames: string[];
  chapterIds: string[];
  questionIds: string[];
}) {
  if (!supabase) return null;

  const now = Date.now();
  const { data, error } = await supabase
    .from('practice_sessions')
    .insert({
      user_id: input.userId,
      mode: input.mode,
      status: 'in_progress',
      subject_ids: input.subjectNames,
      chapter_ids: input.chapterIds,
      question_count: input.questionIds.length,
      started_at: new Date(now).toISOString(),
      raw: {
        questionIds: input.questionIds,
        subjects: input.subjectNames,
        chapters: input.chapterIds,
        userAnswers: {},
        createdAt: now,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.warn('Unable to create practice session in Supabase:', error.message);
    return null;
  }

  return data.id as string;
}

export async function savePracticeAnswer(input: {
  sessionId: string;
  userId: string;
  questionId: string;
  selectedChoice: string;
  correctAnswer: string;
  isCorrect: boolean;
  timeSpentSeconds?: number;
}) {
  if (!supabase || !isUuid(input.sessionId)) return;

  const { error } = await supabase
    .from('practice_answers')
    .upsert({
      session_id: input.sessionId,
      user_id: input.userId,
      question_id: input.questionId,
      selected_choice: input.selectedChoice,
      correct_answer: input.correctAnswer,
      is_correct: input.isCorrect,
      time_spent_seconds: input.timeSpentSeconds ?? null,
      answered_at: new Date().toISOString(),
    }, {
      onConflict: 'session_id,question_id',
    });

  if (error) {
    console.warn('Unable to save practice answer in Supabase:', error.message);
  }
}

export async function updatePracticeSessionRecord(input: {
  session: TestSession;
  userId: string;
  status: PracticeSessionStatus;
}) {
  if (!supabase || !isUuid(input.session.id)) return;

  const completedAt = input.status === 'completed' ? new Date().toISOString() : null;
  const { error } = await supabase
    .from('practice_sessions')
    .update({
      status: input.status,
      completed_at: completedAt,
      total_time_seconds: input.session.timeSpent,
      raw: {
        questionIds: input.session.questionIds,
        subjects: input.session.subjects,
        chapters: input.session.chapters,
        userAnswers: input.session.userAnswers,
        createdAt: input.session.createdAt,
      },
    })
    .eq('id', input.session.id)
    .eq('user_id', input.userId);

  if (error) {
    console.warn('Unable to update practice session in Supabase:', error.message);
  }
}

export async function getPracticeAnswersForSession(sessionId: string, userId: string): Promise<PracticeAnswerRecord[]> {
  if (!supabase || !isUuid(sessionId)) return [];

  const { data, error } = await supabase
    .from('practice_answers')
    .select('question_id, selected_choice, correct_answer, is_correct, time_spent_seconds, answered_at')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('answered_at', { ascending: true });

  if (error) {
    console.warn('Unable to load practice answers from Supabase:', error.message);
    return [];
  }

  return (data ?? []) as PracticeAnswerRecord[];
}

export async function getPracticeSessionRecord(
  sessionId: string,
  userId: string,
  options?: { answeredOnly?: boolean },
): Promise<TestSession | null> {
  if (!supabase || !isUuid(sessionId)) return null;

  const [{ data, error }, answerRows] = await Promise.all([
    supabase
      .from('practice_sessions')
      .select('id, mode, status, subject_ids, chapter_ids, question_count, started_at, total_time_seconds, raw')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle(),
    getPracticeAnswersForSession(sessionId, userId),
  ]);

  if (error || !data) {
    if (error) console.warn('Unable to load practice session from Supabase:', error.message);
    return null;
  }

  const raw = (data.raw ?? {}) as PracticeSessionRaw;
  const answeredQuestionIds = answerRows
    .map((answer) => answer.question_id)
    .filter(Boolean);
  const rawAnsweredQuestionIds = Object.keys(raw.userAnswers ?? {});
  const questionIds = options?.answeredOnly && answeredQuestionIds.length > 0
    ? answeredQuestionIds
    : options?.answeredOnly && rawAnsweredQuestionIds.length > 0
      ? rawAnsweredQuestionIds
      : raw.questionIds ?? [];
  const userAnswerChoices = Object.fromEntries(
    answerRows
      .filter((answer) => answer.selected_choice)
      .map((answer) => [answer.question_id, answer.selected_choice!.toUpperCase()]),
  );
  const statusMap: Record<string, TestSession['status']> = {
    in_progress: 'In-Progress',
    completed: 'Completed',
    suspended: 'Suspended',
  };

  return {
    id: data.id as string,
    createdAt: raw.createdAt ?? new Date(data.started_at as string).getTime(),
    mode: data.mode as TestMode,
    subjects: raw.subjects ?? ((data.subject_ids as string[] | null) ?? []),
    chapters: raw.chapters ?? ((data.chapter_ids as string[] | null) ?? []),
    questionCount: (data.question_count as number | null) ?? questionIds.length,
    questionIds,
    userAnswers: raw.userAnswers ?? {},
    userAnswerChoices,
    status: statusMap[(data.status as string | null) ?? 'in_progress'] ?? 'In-Progress',
    timeSpent: (data.total_time_seconds as number | null) ?? 0,
  };
}
