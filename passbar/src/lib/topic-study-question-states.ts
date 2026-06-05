import { supabase } from './supabase';

type BrowseQuestionStateRow = {
  question_id: string;
  chapter_id: string | null;
  is_learned: boolean;
  is_marked: boolean;
};

export type BrowseQuestionState = {
  isLearned: boolean;
  isMarked: boolean;
};

/** Load states for given questionIds. Returns a Map<questionId, BrowseQuestionState>. */
export async function getBrowseQuestionStates(
  userId: string,
  questionIds: string[],
): Promise<Map<string, BrowseQuestionState>> {
  if (!supabase || questionIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('topic_study_question_states')
    .select('question_id, chapter_id, is_learned, is_marked')
    .eq('user_id', userId)
    .in('question_id', questionIds);
  if (error) {
    console.warn('[PassBar] Failed to load browse question states:', error.message);
    return new Map();
  }
  return new Map(
    ((data ?? []) as BrowseQuestionStateRow[]).map((r) => [
      r.question_id,
      { isLearned: r.is_learned, isMarked: r.is_marked },
    ]),
  );
}

/** Get just the marked question IDs (replaces getBrowseMarkedQuestionIds from browse-marks.ts) */
export async function getBrowseMarkedQuestionIds(
  userId: string,
  questionIds?: string[],
): Promise<Set<string>> {
  if (!supabase) return new Set();
  let query = supabase
    .from('topic_study_question_states')
    .select('question_id')
    .eq('user_id', userId)
    .eq('is_marked', true);
  if (questionIds?.length) query = query.in('question_id', questionIds);
  const { data, error } = await query;
  if (error) {
    console.warn('[PassBar] Failed to load browse marked question ids:', error.message);
    return new Set();
  }
  return new Set(((data ?? []) as { question_id: string }[]).map((r) => r.question_id));
}

/** Get chapter IDs that have at least one marked question */
export async function getBrowseMarkedChapterIds(
  userId: string,
  allChapterQIds: Record<string, string[]>,
): Promise<Set<string>> {
  if (!supabase) return new Set();
  const { data, error } = await supabase
    .from('topic_study_question_states')
    .select('question_id')
    .eq('user_id', userId)
    .eq('is_marked', true);
  if (error) {
    console.warn('[PassBar] Failed to load browse marked chapter ids:', error.message);
    return new Set();
  }
  const markedSet = new Set(((data ?? []) as { question_id: string }[]).map((r) => r.question_id));
  const result = new Set<string>();
  for (const [chapterId, qIds] of Object.entries(allChapterQIds)) {
    if (qIds.some((qId) => markedSet.has(qId))) result.add(chapterId);
  }
  return result;
}

/** Upsert a question state (learned and/or marked). isLearned/isMarked are optional — only provided fields are updated. */
export async function upsertBrowseQuestionState(input: {
  userId: string;
  questionId: string;
  chapterId?: string;
  isLearned?: boolean;
  isMarked?: boolean;
}): Promise<boolean> {
  if (!supabase) return false;

  const { data: existing, error: existingError } = await supabase
    .from('topic_study_question_states')
    .select('chapter_id, is_learned, is_marked, first_seen_at')
    .eq('user_id', input.userId)
    .eq('question_id', input.questionId)
    .maybeSingle();

  if (existingError) {
    console.warn('[PassBar] Failed to read browse question state:', existingError.message);
    return false;
  }

  const { error } = await supabase
    .from('topic_study_question_states')
    .upsert(
      {
        user_id: input.userId,
        question_id: input.questionId,
        chapter_id: input.chapterId ?? existing?.chapter_id ?? null,
        is_learned: input.isLearned ?? existing?.is_learned ?? false,
        is_marked: input.isMarked ?? existing?.is_marked ?? false,
        first_seen_at: existing?.first_seen_at ?? new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,question_id' },
    );

  if (error && !error.message.includes('201')) {
    console.warn('[PassBar] Failed to upsert browse question state:', error.message);
    return false;
  }
  return true;
}

/** Delete all question states for a user's chapter (used when restarting from scratch). */
export async function deleteBrowseQuestionStatesForChapter(userId: string, chapterId: string) {
  if (!supabase) return;
  await supabase
    .from('topic_study_question_states')
    .delete()
    .eq('user_id', userId)
    .eq('chapter_id', chapterId);
}

/** Get per-chapter counts of learned and marked questions. Returns Map<chapterId, {learnedCount, markedCount}>. */
export async function getBrowseChapterStateCounts(
  userId: string,
): Promise<Map<string, { learnedCount: number; markedCount: number }>> {
  if (!supabase) return new Map();
  const { data, error } = await supabase
    .from('topic_study_question_states')
    .select('chapter_id, is_learned, is_marked')
    .eq('user_id', userId);
  if (error) {
    console.warn('[PassBar] Failed to load browse chapter state counts:', error.message);
    return new Map();
  }
  const result = new Map<string, { learnedCount: number; markedCount: number }>();
  ((data ?? []) as { chapter_id: string | null; is_learned: boolean; is_marked: boolean }[]).forEach((r) => {
    if (!r.chapter_id) return;
    const existing = result.get(r.chapter_id) ?? { learnedCount: 0, markedCount: 0 };
    result.set(r.chapter_id, {
      learnedCount: existing.learnedCount + (r.is_learned ? 1 : 0),
      markedCount: existing.markedCount + (r.is_marked ? 1 : 0),
    });
  });
  return result;
}
