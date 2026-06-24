import { api } from './api';
import type { TestMode, TestSession } from './types';

type PracticeSessionStatus = 'in_progress' | 'completed' | 'suspended';

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

const STATUS_TO_API: Record<PracticeSessionStatus, TestSession['status']> = {
  in_progress: 'In-Progress',
  completed: 'Completed',
  suspended: 'Suspended',
};

export async function createPracticeSessionRecord(input: {
  userId: string;
  mode: TestMode;
  subjectNames: string[];
  chapterIds: string[];
  questionIds: string[];
}) {
  try {
    const { id } = await api.post<{ id: string | null }>('/attempts/sessions', {
      mode: input.mode,
      subjectNames: input.subjectNames,
      chapterIds: input.chapterIds,
      questionIds: input.questionIds,
    });
    return id;
  } catch (err) {
    console.warn('Unable to create practice session:', err);
    return null;
  }
}

export async function savePracticeAnswer(input: {
  sessionId: string;
  userId: string;
  questionId: string;
  selectedChoice: string;
  timeSpentSeconds?: number;
}) {
  if (!isUuid(input.sessionId)) return false;
  try {
    await api.post(`/attempts/sessions/${input.sessionId}/answers`, {
      questionId: input.questionId,
      selectedChoice: input.selectedChoice,
      timeSpentSeconds: input.timeSpentSeconds,
    });
    return true;
  } catch (err) {
    console.warn('Unable to save practice answer:', err);
    return false;
  }
}

export async function updatePracticeSessionRecord(input: {
  session: TestSession;
  userId: string;
  status: PracticeSessionStatus;
}) {
  if (!isUuid(input.session.id)) return;
  try {
    await api.patch(`/attempts/sessions/${input.session.id}`, {
      status: STATUS_TO_API[input.status],
      timeSpent: input.session.timeSpent,
      questionIds: input.session.questionIds,
      subjects: input.session.subjects,
      chapters: input.session.chapters,
      userAnswers: input.session.userAnswers,
      createdAt: input.session.createdAt,
    });
  } catch (err) {
    console.warn('Unable to update practice session:', err);
  }
}

export async function deletePracticeSessionRecord(input: { sessionId: string; userId: string }) {
  if (!isUuid(input.sessionId)) return false;
  try {
    await api.delete(`/attempts/sessions/${input.sessionId}`);
    return true;
  } catch (err) {
    console.warn('Unable to delete practice session:', err);
    return false;
  }
}

export async function deletePracticeAnswersForSession(input: { sessionId: string; userId: string }) {
  if (!isUuid(input.sessionId)) return false;
  try {
    await api.delete(`/attempts/sessions/${input.sessionId}/answers`);
    return true;
  } catch (err) {
    console.warn('Unable to delete practice answers:', err);
    return false;
  }
}

export async function getPracticeAnswersForSession(sessionId: string, _userId: string): Promise<PracticeAnswerRecord[]> {
  if (!isUuid(sessionId)) return [];
  try {
    const rows = await api.get<Array<{
      questionId: string;
      selectedChoice: string | null;
      correctAnswer: string | null;
      isCorrect: boolean | null;
      timeSpentSeconds: number | null;
      answeredAt: string | null;
    }>>(`/attempts/sessions/${sessionId}/answers`);
    return rows.map((r) => ({
      question_id: r.questionId,
      selected_choice: r.selectedChoice,
      correct_answer: r.correctAnswer,
      is_correct: r.isCorrect,
      time_spent_seconds: r.timeSpentSeconds,
      answered_at: r.answeredAt,
    }));
  } catch (err) {
    console.warn('Unable to load practice answers:', err);
    return [];
  }
}

export async function getPracticeSessionRecord(
  sessionId: string,
  _userId: string,
  options?: { answeredOnly?: boolean },
): Promise<TestSession | null> {
  if (!isUuid(sessionId)) return null;
  try {
    const query = options?.answeredOnly ? '?answeredOnly=true' : '';
    const data = await api.get<TestSession | null>(`/attempts/sessions/${sessionId}${query}`);
    return data;
  } catch (err) {
    console.warn('Unable to load practice session:', err);
    return null;
  }
}
