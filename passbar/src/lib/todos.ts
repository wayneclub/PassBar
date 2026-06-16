"use client";

import { supabase } from './supabase';
import type { ChapterReviewInfo, TodayMissionChapter } from './smart-planner';

export type TodoStatus = 'new' | 'scheduled' | 'in_progress' | 'completed';
export type TodoType = 'manual' | 'review' | 'practice';

export type Todo = {
  id: string;
  user_id: string;
  title: string;
  status: TodoStatus;
  type: TodoType;
  due_date: string | null;
  chapter_id: string | null;
  chapter_ids: string | null;
  auto_generated: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateTodoInput = {
  title: string;
  status?: TodoStatus;
  type?: TodoType;
  due_date?: string | null;
  chapter_id?: string | null;
  chapter_ids?: string | null;
  auto_generated?: boolean;
};

export async function fetchTodos(userId: string): Promise<Todo[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Todo[];
}

export async function createTodo(userId: string, input: CreateTodoInput): Promise<Todo | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('todos')
    .insert({ user_id: userId, status: 'new', type: 'manual', ...input })
    .select()
    .single();
  return data as Todo | null;
}

export async function updateTodo(id: string, patch: Partial<Pick<Todo, 'title' | 'status' | 'type' | 'due_date' | 'chapter_id' | 'chapter_ids'>>): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('todos')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

export async function deleteTodo(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('todos').delete().eq('id', id);
  return !error;
}

function todayEndIso() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/**
 * Sync auto todos from today's mission.
 * - Never deletes todos that are completed or in_progress (user has acted on them).
 * - Removes stale auto-todos (not in today's mission) only if status is 'new' or 'scheduled'.
 * - Skips insert if any todo (auto or manual) already has the same chapter_id.
 */
export async function syncAutoTodos(
  userId: string,
  newChapters: TodayMissionChapter[],
  reviewChapters: ChapterReviewInfo[],
): Promise<Todo[]> {
  if (!supabase) return [];

  // Fetch all todos for the user (not just auto-generated) to avoid duplicating manual adds
  const { data: allExisting } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId);

  const allRows = (allExisting ?? []) as Todo[];
  const autoRows = allRows.filter((r) => r.auto_generated);
  const manualRows = allRows.filter((r) => !r.auto_generated);

  const newIds = new Set(newChapters.map((c) => c.id));
  const reviewIds = new Set(reviewChapters.map((c) => c.chapterId));
  const allReviewChapterIds = reviewChapters.map((c) => c.chapterId).join(',');

  // Delete ALL un-actioned auto-todos (new/scheduled). Re-inserting fresh avoids
  // duplicates caused by stale chapter IDs from previous runs.
  const deletable = autoRows.filter(
    (r) => r.status === 'new' || r.status === 'scheduled',
  );
  if (deletable.length > 0) {
    await supabase.from('todos').delete().in('id', deletable.map((r) => r.id));
  }

  // Only skip chapters already covered by a manual todo or an in_progress/completed auto-todo
  const preservedChapterIds = new Set([
    ...manualRows.filter((r) => r.chapter_id).map((r) => r.chapter_id as string),
    ...autoRows
      .filter((r) => r.chapter_id && (r.status === 'in_progress' || r.status === 'completed'))
      .map((r) => r.chapter_id as string),
  ]);

  const toInsert: object[] = [];

  for (const ch of newChapters) {
    if (!preservedChapterIds.has(ch.id)) {
      toInsert.push({
        user_id: userId,
        title: `${ch.subject} · ${ch.name}`,
        status: 'new' as TodoStatus,
        type: 'practice' as TodoType,
        chapter_id: ch.id,
        chapter_ids: ch.id,
        auto_generated: true,
        due_date: todayEndIso(),
      });
    }
  }

  for (const ch of reviewChapters) {
    if (!preservedChapterIds.has(ch.chapterId)) {
      toInsert.push({
        user_id: userId,
        title: `${ch.subject} · ${ch.chapterName}`,
        status: 'new' as TodoStatus,
        type: 'review' as TodoType,
        chapter_id: ch.chapterId,
        chapter_ids: allReviewChapterIds,
        auto_generated: true,
        due_date: todayEndIso(),
      });
    }
  }

  if (toInsert.length > 0) {
    await supabase.from('todos').insert(toInsert);
  }

  const { data: fresh } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (fresh ?? []) as Todo[];
}

/** Manually add a single chapter as a todo. Returns null if already exists. */
export async function addChapterAsTodo(
  userId: string,
  chapter: { id: string; name: string; subject: string; type: 'practice' | 'review'; chapterIds?: string },
): Promise<Todo | null> {
  if (!supabase) return null;

  // Check if already exists
  const { data: existing } = await supabase
    .from('todos')
    .select('id')
    .eq('user_id', userId)
    .eq('chapter_id', chapter.id)
    .limit(1);

  if (existing && existing.length > 0) return null;

  const { data, error } = await supabase
    .from('todos')
    .insert({
      user_id: userId,
      title: `${chapter.subject} · ${chapter.name}`,
      status: 'new' as TodoStatus,
      type: chapter.type,
      chapter_id: chapter.id,
      chapter_ids: chapter.chapterIds ?? chapter.id,
      auto_generated: false,
      due_date: todayEndIso(),
    })
    .select()
    .single();

  if (error) {
    console.error("Insert error:", error);
    return {
      id: `error-${Date.now()}`,
      user_id: userId,
      title: `Error: ${error.message || JSON.stringify(error)}`,
      status: 'new',
      type: chapter.type,
      chapter_id: null,
      chapter_ids: null,
      auto_generated: false,
      due_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Todo;
  }

  return data as Todo | null;
}
