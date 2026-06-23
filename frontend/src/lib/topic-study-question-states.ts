import { api } from './api';

export type BrowseQuestionState = {
  isLearned: boolean;
  isMarked: boolean;
};

type StateResponse = { isLearned: boolean; isMarked: boolean };

export async function getBrowseQuestionStates(
  _userId: string,
  questionIds: string[],
): Promise<Map<string, BrowseQuestionState>> {
  if (questionIds.length === 0) return new Map();
  try {
    const data = await api.get<Record<string, StateResponse>>(
      `/attempts/topic-study/states?questionIds=${encodeURIComponent(questionIds.join(','))}`,
    );
    return new Map(Object.entries(data).map(([id, s]) => [id, { isLearned: s.isLearned, isMarked: s.isMarked }]));
  } catch (err) {
    console.warn('[PassBar] Failed to load browse question states:', err);
    return new Map();
  }
}

export async function getBrowseMarkedQuestionIds(
  _userId: string,
  questionIds?: string[],
): Promise<Set<string>> {
  try {
    const query = questionIds?.length ? `?questionIds=${encodeURIComponent(questionIds.join(','))}` : '';
    const ids = await api.get<string[]>(`/attempts/topic-study/states/marked${query}`);
    return new Set(ids);
  } catch (err) {
    console.warn('[PassBar] Failed to load browse marked question ids:', err);
    return new Set();
  }
}

export async function getBrowseMarkedChapterIds(_userId: string): Promise<Set<string>> {
  try {
    const ids = await api.get<string[]>('/attempts/topic-study/states/marked-chapters');
    return new Set(ids);
  } catch (err) {
    console.warn('[PassBar] Failed to load browse marked chapter ids:', err);
    return new Set();
  }
}

export async function upsertBrowseQuestionState(input: {
  userId: string;
  questionId: string;
  chapterId?: string;
  isLearned?: boolean;
  isMarked?: boolean;
}): Promise<boolean> {
  try {
    await api.put('/attempts/topic-study/states', {
      questionId: input.questionId,
      chapterId: input.chapterId,
      isLearned: input.isLearned,
      isMarked: input.isMarked,
    });
    return true;
  } catch (err) {
    console.warn('[PassBar] Failed to upsert browse question state:', err);
    return false;
  }
}

export async function deleteBrowseQuestionStatesForChapter(_userId: string, chapterId: string) {
  await api.delete(`/attempts/topic-study/states/${encodeURIComponent(chapterId)}`).catch(() => undefined);
}

export async function getBrowseChapterStateCounts(
  _userId: string,
): Promise<Map<string, { learnedCount: number; markedCount: number }>> {
  try {
    const data = await api.get<Record<string, { learnedCount: number; markedCount: number }>>(
      '/attempts/topic-study/states/chapter-counts',
    );
    return new Map(Object.entries(data));
  } catch (err) {
    console.warn('[PassBar] Failed to load browse chapter state counts:', err);
    return new Map();
  }
}
