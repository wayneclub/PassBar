import { api, ApiError } from './api';
import { QuestionStatus } from './types';

export type QuestionStatusCounts = Record<QuestionStatus, number>;

export const emptyQuestionStatusCounts: QuestionStatusCounts = {
  Unused: 0,
  Incorrect: 0,
  Marked: 0,
  Omitted: 0,
  Correct: 0,
};

export async function getQuestionStatusCounts(_userId: string, totalQuestions: number): Promise<QuestionStatusCounts> {
  try {
    return await api.get<QuestionStatusCounts>(`/attempts/question-progress/counts?totalQuestions=${totalQuestions}`);
  } catch (err) {
    console.warn('[PassBar] Failed to load question status counts:', err);
    return { ...emptyQuestionStatusCounts, Unused: totalQuestions };
  }
}

export async function saveQuestionAnswerProgress(input: {
  userId: string;
  questionId: string;
  selectedChoice: string;
  timeSpentSeconds?: number;
}) {
  try {
    await api.post('/attempts/question-progress/answer', {
      questionId: input.questionId,
      selectedChoice: input.selectedChoice,
      timeSpentSeconds: input.timeSpentSeconds,
    });
    return true;
  } catch (err) {
    console.warn('[PassBar] Failed to save answer progress:', err);
    return false;
  }
}

export async function getQuestionAnswerStats(questionId: string): Promise<{
  totalAnswers: number;
  correctAnswers: number;
  correctPercent: number | null;
  choicePercents: Partial<Record<'A' | 'B' | 'C' | 'D', number>>;
}> {
  try {
    return await api.get(`/attempts/question-progress/stats/${encodeURIComponent(questionId)}`);
  } catch (err) {
    console.warn('[PassBar] Failed to load question answer stats:', err);
    return { totalAnswers: 0, correctAnswers: 0, correctPercent: null, choicePercents: {} };
  }
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
  _userId: string,
): Promise<Map<string, { status: string; is_marked: boolean }>> {
  try {
    const data = await api.get<Record<string, { status: string; isMarked: boolean }>>('/attempts/question-progress/all');
    return new Map(Object.entries(data).map(([id, v]) => [id, { status: v.status, is_marked: v.isMarked }]));
  } catch {
    return new Map();
  }
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
  if (!userId) return filters.Unused ? questionIds : [];

  try {
    return await api.post<string[]>('/attempts/question-progress/filter', {
      questionIds,
      unused: filters.Unused,
      incorrect: filters.Incorrect,
      marked: filters.Marked,
      omitted: filters.Omitted,
      correct: filters.Correct,
    });
  } catch (err) {
    // Allows a freshly updated frontend to keep working with a still-running
    // pre-POST backend during local development. Do not use this escape hatch
    // for a large custom test: URL limits are exactly why POST is canonical.
    const legacyQuery = new URLSearchParams({
      questionIds: questionIds.join(','),
      unused: String(filters.Unused),
      incorrect: String(filters.Incorrect),
      marked: String(filters.Marked),
      omitted: String(filters.Omitted),
      correct: String(filters.Correct),
    });
    if (err instanceof ApiError && err.status === 404 && legacyQuery.toString().length <= 12_000) {
      try {
        return await api.get<string[]>(`/attempts/question-progress/filter?${legacyQuery.toString()}`);
      } catch {
        // Preserve the fail-closed behavior below.
      }
    }
    console.warn('[PassBar] Failed to load question statuses for filtering:', err);
    // A failed status query must not silently bypass the selected question
    // mode (for example, returning answered questions for an "Unused" test).
    // Fail closed so the UI shows its normal "no questions" state instead.
    return [];
  }
}

export async function getMarkedQuestionIds(_userId: string, questionIds: string[]): Promise<Set<string>> {
  try {
    const ids = await api.get<string[]>(`/attempts/question-progress/marked?questionIds=${encodeURIComponent(questionIds.join(','))}`);
    return new Set(ids);
  } catch (err) {
    console.warn('[PassBar] Failed to load marked questions:', err);
    return new Set();
  }
}

export async function setQuestionMarked(input: {
  userId: string;
  questionId: string;
  isMarked: boolean;
}) {
  try {
    await api.post('/attempts/question-progress/mark', { questionId: input.questionId, isMarked: input.isMarked });
    return true;
  } catch (err) {
    console.warn('[PassBar] Failed to update marked question:', err);
    return false;
  }
}

export async function saveOmittedQuestionProgress(input: {
  userId: string;
  questionIds: string[];
}) {
  if (input.questionIds.length === 0) return;
  try {
    await api.post('/attempts/question-progress/omitted', { questionIds: input.questionIds });
  } catch (err) {
    console.warn('[PassBar] Failed to save omitted progress:', err);
  }
}

/** Deletes all question progress and practice sessions for the signed-in user. */
export async function clearUserProgress(
  _userId: string,
  scope: 'practice' | 'browse' | 'all' = 'all',
): Promise<boolean> {
  try {
    if (scope === 'practice' || scope === 'all') {
      await api.delete('/attempts/question-progress/clear');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('passbar_sessions');
        localStorage.removeItem('uprep_sessions');
      }
    }
    if (scope === 'browse' || scope === 'all') {
      await api.delete('/attempts/topic-study/clear');
    }
    return true;
  } catch (err) {
    console.warn('[PassBar] clear-progress failed:', err);
    return false;
  }
}
