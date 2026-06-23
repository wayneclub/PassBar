import { api } from './api';

export type BrowseProgressRow = {
  user_id: string;
  chapter_id: string;
  viewed_count: number;
  last_question_id: string | null;
  last_question_index: number;
  updated_at: string;
};

type ProgressResponse = {
  userId: string;
  chapterId: string;
  viewedCount: number;
  lastQuestionId: string | null;
  lastQuestionIndex: number;
  updatedAt: string;
};

export async function getBrowseProgressByUser(_userId: string): Promise<BrowseProgressRow[]> {
  try {
    const rows = await api.get<ProgressResponse[]>('/attempts/topic-study/progress');
    return rows.map((r) => ({
      user_id: r.userId,
      chapter_id: r.chapterId,
      viewed_count: r.viewedCount,
      last_question_id: r.lastQuestionId,
      last_question_index: r.lastQuestionIndex,
      updated_at: r.updatedAt,
    }));
  } catch {
    return [];
  }
}

export async function upsertBrowseProgress(input: {
  userId: string;
  chapterId: string;
  viewedCount: number;
  lastQuestionId: string | null;
  lastQuestionIndex: number;
}) {
  await api.put('/attempts/topic-study/progress', {
    chapterId: input.chapterId,
    viewedCount: input.viewedCount,
    lastQuestionId: input.lastQuestionId,
    lastQuestionIndex: input.lastQuestionIndex,
  }).catch(() => undefined);
}

export async function deleteBrowseProgressForUser(_userId: string, chapterIds?: string[]) {
  const query = chapterIds?.length ? `?chapterIds=${encodeURIComponent(chapterIds.join(','))}` : '';
  await api.delete(`/attempts/topic-study/progress${query}`).catch(() => undefined);
}
