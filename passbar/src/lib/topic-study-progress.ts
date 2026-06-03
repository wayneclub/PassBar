import { supabase } from './supabase';

export type BrowseProgressRow = {
  user_id: string;
  chapter_id: string;
  viewed_count: number;
  last_question_id: string | null;
  last_question_index: number;
  updated_at: string;
};

export async function getBrowseProgressByUser(userId: string): Promise<BrowseProgressRow[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('topic_study_progress')
    .select('*')
    .eq('user_id', userId);
  return (data ?? []) as BrowseProgressRow[];
}

export async function upsertBrowseProgress(input: {
  userId: string;
  chapterId: string;
  viewedCount: number;
  lastQuestionId: string | null;
  lastQuestionIndex: number;
}) {
  if (!supabase) return;
  await supabase.from('topic_study_progress').upsert({
    user_id: input.userId,
    chapter_id: input.chapterId,
    viewed_count: input.viewedCount,
    last_question_id: input.lastQuestionId,
    last_question_index: input.lastQuestionIndex,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,chapter_id' });
}

export async function deleteBrowseProgressForUser(userId: string, chapterIds?: string[]) {
  if (!supabase) return;
  let query = supabase.from('topic_study_progress').delete().eq('user_id', userId);
  if (chapterIds?.length) {
    query = query.in('chapter_id', chapterIds);
  }
  await query;
}
