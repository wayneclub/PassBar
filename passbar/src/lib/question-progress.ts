import { supabase } from './supabase';
import { QuestionStatus } from './types';

export type QuestionStatusCounts = Record<QuestionStatus, number>;

export const emptyQuestionStatusCounts: QuestionStatusCounts = {
  Unused: 0,
  Incorrect: 0,
  Marked: 0,
  Omitted: 0,
  Correct: 0,
};

type ProgressRow = {
  status: 'correct' | 'incorrect' | 'omitted';
  is_marked: boolean | null;
};

function isNoContentError(error: { message?: string } | null | undefined) {
  return Boolean(error?.message?.includes('204'));
}

export async function getQuestionStatusCounts(userId: string, totalQuestions: number): Promise<QuestionStatusCounts> {
  if (!supabase) return { ...emptyQuestionStatusCounts, Unused: totalQuestions };

  const { data, error } = await supabase
    .from('user_question_progress')
    .select('status, is_marked')
    .eq('user_id', userId);

  if (error || !data) {
    console.warn('[PassBar] Failed to load question status counts:', error?.message);
    return { ...emptyQuestionStatusCounts, Unused: totalQuestions };
  }

  const counts = { ...emptyQuestionStatusCounts };
  (data as ProgressRow[]).forEach((row) => {
    if (row.status === 'correct') counts.Correct += 1;
    if (row.status === 'incorrect') counts.Incorrect += 1;
    if (row.status === 'omitted') counts.Omitted += 1;
    if (row.is_marked) counts.Marked += 1;
  });
  counts.Unused = Math.max(totalQuestions - data.length, 0);
  return counts;
}

export async function saveQuestionAnswerProgress(input: {
  userId: string;
  questionId: string;
  selectedChoice: string;
  correctAnswer: string;
  isCorrect: boolean;
  timeSpentSeconds?: number;
}) {
  if (!supabase) return false;

  const { data: existing } = await supabase
    .from('user_question_progress')
    .select('times_answered, is_marked, time_spent_seconds')
    .eq('user_id', input.userId)
    .eq('question_id', input.questionId)
    .maybeSingle();

  const existingTimesAnswered = typeof existing?.times_answered === 'number' ? existing.times_answered : 0;
  const existingTimeSpent = typeof existing?.time_spent_seconds === 'number' ? existing.time_spent_seconds : 0;

  const { error } = await supabase
    .from('user_question_progress')
    .upsert({
      user_id: input.userId,
      question_id: input.questionId,
      status: input.isCorrect ? 'correct' : 'incorrect',
      selected_choice: input.selectedChoice,
      correct_answer: input.correctAnswer,
      is_correct: input.isCorrect,
      is_marked: Boolean(existing?.is_marked),
      times_answered: existingTimesAnswered + 1,
      time_spent_seconds: existingTimeSpent + (input.timeSpentSeconds ?? 0),
      last_seen_at: new Date().toISOString(),
      last_answered_at: new Date().toISOString(),
    }, { onConflict: 'user_id,question_id' });

  if (error && !error.message.includes('201')) {
    console.warn('[PassBar] Failed to save answer progress:', error.message);
    return false;
  }

  return true;
}

export async function getQuestionAnswerStats(questionId: string): Promise<{
  totalAnswers: number;
  correctAnswers: number;
  correctPercent: number | null;
  choicePercents: Partial<Record<'A' | 'B' | 'C' | 'D', number>>;
}> {
  if (!supabase) return { totalAnswers: 0, correctAnswers: 0, correctPercent: null, choicePercents: {} };

  const choicePercents: Partial<Record<'A' | 'B' | 'C' | 'D', number>> = {};
  const { data: choiceData, error: choiceError } = await supabase.rpc('get_question_choice_stats', {
    p_question_id: questionId,
  });

  if (!choiceError && Array.isArray(choiceData)) {
    choiceData.forEach((row) => {
      const choice = String((row as { selected_choice?: string | null }).selected_choice ?? '').toUpperCase();
      if (choice === 'A' || choice === 'B' || choice === 'C' || choice === 'D') {
        choicePercents[choice] = (row as { answer_percent?: number | null }).answer_percent ?? 0;
      }
    });
  } else if (choiceError) {
    console.warn('[PassBar] Failed to load question choice stats:', choiceError.message);
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_question_answer_stats', {
    p_question_id: questionId,
  });

  if (!rpcError && Array.isArray(rpcData) && rpcData[0]) {
    const row = rpcData[0] as {
      total_answers: number | null;
      correct_answers: number | null;
      correct_percent: number | null;
    };
    return {
      totalAnswers: row.total_answers ?? 0,
      correctAnswers: row.correct_answers ?? 0,
      correctPercent: row.correct_percent,
      choicePercents,
    };
  }

  const [totalResult, correctResult] = await Promise.all([
    supabase
      .from('practice_answers')
      .select('id', { count: 'exact', head: true })
      .eq('question_id', questionId),
    supabase
      .from('practice_answers')
      .select('id', { count: 'exact', head: true })
      .eq('question_id', questionId)
      .eq('is_correct', true),
  ]);

  if (totalResult.error || correctResult.error) {
    console.warn('[PassBar] Failed to load question answer stats:', totalResult.error?.message ?? correctResult.error?.message);
    return { totalAnswers: 0, correctAnswers: 0, correctPercent: null, choicePercents };
  }

  const totalAnswers = totalResult.count ?? 0;
  const correctAnswers = correctResult.count ?? 0;
  return {
    totalAnswers,
    correctAnswers,
    correctPercent: totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : null,
    choicePercents,
  };
}

export type QuestionStatusFilter = {
  Unused: boolean;
  Incorrect: boolean;
  Marked: boolean;
  Omitted: boolean;
  Correct: boolean;
};

/** Returns a map of question_id → {status, is_marked} for all answered questions for the user. */
export async function getAllUserProgress(
  userId: string,
): Promise<Map<string, { status: string; is_marked: boolean }>> {
  if (!supabase) return new Map();

  const { data, error } = await supabase
    .from('user_question_progress')
    .select('question_id, status, is_marked')
    .eq('user_id', userId);

  if (error || !data) return new Map();
  return new Map(
    (data as Array<{ question_id: string; status: string; is_marked: boolean | null }>).map(
      (r) => [r.question_id, { status: r.status, is_marked: Boolean(r.is_marked) }],
    ),
  );
}

/**
 * Returns the subset of questionIds that match any of the enabled status filters.
 * If no filters are enabled, returns all questionIds (fallback).
 */
export async function filterQuestionIdsByStatus(
  userId: string | undefined,
  questionIds: string[],
  filters: QuestionStatusFilter,
): Promise<string[]> {
  const anyEnabled = Object.values(filters).some(Boolean);
  if (!anyEnabled) return questionIds;

  // If no user or no supabase, treat everything as Unused
  if (!userId || !supabase) {
    return filters.Unused ? questionIds : [];
  }

  const { data, error } = await supabase
    .from('user_question_progress')
    .select('question_id, status, is_marked')
    .eq('user_id', userId)
    .in('question_id', questionIds);

  if (error || !data) {
    console.warn('[PassBar] Failed to load question statuses for filtering:', error?.message);
    return questionIds;
  }

  const progressMap = new Map<string, { status: string; is_marked: boolean }>(
    (data as Array<{ question_id: string; status: string; is_marked: boolean | null }>).map(
      (row) => [row.question_id, { status: row.status, is_marked: Boolean(row.is_marked) }]
    )
  );

  return questionIds.filter((id) => {
    const progress = progressMap.get(id);
    if (!progress) return filters.Unused; // not in progress table → Unused
    if (filters.Marked && progress.is_marked) return true;
    if (filters.Correct && progress.status === 'correct') return true;
    if (filters.Incorrect && progress.status === 'incorrect') return true;
    if (filters.Omitted && progress.status === 'omitted') return true;
    return false;
  });
}

export async function getMarkedQuestionIds(userId: string, questionIds: string[]): Promise<Set<string>> {
  if (!supabase || questionIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('user_question_progress')
    .select('question_id')
    .eq('user_id', userId)
    .eq('is_marked', true)
    .in('question_id', questionIds);

  if (error || !data) {
    console.warn('[PassBar] Failed to load marked questions:', error?.message);
    return new Set();
  }

  return new Set((data as Array<{ question_id: string }>).map((row) => row.question_id));
}

export async function setQuestionMarked(input: {
  userId: string;
  questionId: string;
  isMarked: boolean;
}) {
  if (!supabase) return false;

  const { data: existing, error: existingError } = await supabase
    .from('user_question_progress')
    .select('status, selected_choice, correct_answer, is_correct, times_answered, time_spent_seconds, first_seen_at, last_answered_at')
    .eq('user_id', input.userId)
    .eq('question_id', input.questionId)
    .maybeSingle();

  if (existingError) {
    console.warn('[PassBar] Failed to read marked question state:', existingError.message);
    return false;
  }

  const { error } = await supabase
    .from('user_question_progress')
    .upsert({
      user_id: input.userId,
      question_id: input.questionId,
      status: existing?.status ?? 'omitted',
      selected_choice: existing?.selected_choice ?? null,
      correct_answer: existing?.correct_answer ?? null,
      is_correct: existing?.is_correct ?? false,
      is_marked: input.isMarked,
      times_answered: existing?.times_answered ?? 0,
      time_spent_seconds: existing?.time_spent_seconds ?? 0,
      first_seen_at: existing?.first_seen_at ?? new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      last_answered_at: existing?.last_answered_at ?? null,
    }, { onConflict: 'user_id,question_id' });

  if (error) {
    console.warn('[PassBar] Failed to update marked question:', error.message);
    return false;
  }

  return true;
}

export async function saveOmittedQuestionProgress(input: {
  userId: string;
  questionIds: string[];
}) {
  if (!supabase || input.questionIds.length === 0) return;

  const { data: existing, error: existingError } = await supabase
    .from('user_question_progress')
    .select('question_id')
    .eq('user_id', input.userId)
    .in('question_id', input.questionIds);

  if (existingError) {
    console.warn('[PassBar] Failed to check omitted question progress:', existingError.message);
    return;
  }

  const existingIds = new Set((existing ?? []).map((row) => row.question_id as string));
  const rows = input.questionIds
    .filter((questionId) => !existingIds.has(questionId))
    .map((questionId) => ({
      user_id: input.userId,
      question_id: questionId,
      status: 'omitted',
      is_correct: false,
      last_seen_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('user_question_progress')
    .upsert(rows, { onConflict: 'user_id,question_id' });

  if (error && !error.message.includes('201')) {
    console.warn('[PassBar] Failed to save omitted progress:', error.message);
  }
}

/** Deletes all question progress and practice sessions for the signed-in user. */
export async function clearUserProgress(
  userId: string,
  scope: 'practice' | 'browse' | 'all' = 'all',
): Promise<boolean> {
  if (!supabase) return true;

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user?.id || session.user.id !== userId) {
      console.warn('[PassBar] Unable to verify current user before clearing progress:', sessionError?.message);
      return false;
    }

    const ops = [];

    if (scope === 'practice' || scope === 'all') {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('passbar_sessions');
        localStorage.removeItem('uprep_sessions');
      }
      ops.push(
        supabase.from('practice_answers').delete().eq('user_id', userId).then((r) => r),
        supabase.from('practice_sessions').delete().eq('user_id', userId).then((r) => r),
        supabase.from('user_question_progress').delete().eq('user_id', userId).then((r) => r),
      );
    }

    if (scope === 'browse' || scope === 'all') {
      ops.push(supabase.from('browse_progress').delete().eq('user_id', userId).then((r) => r));
    }

    const results = await Promise.all(ops);
    const failed = results.find((result) => result.error && !isNoContentError(result.error));
    if (failed?.error) {
      console.warn('[PassBar] Failed to clear user progress:', failed.error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[PassBar] clear-progress failed:', err);
    return false;
  }
}
