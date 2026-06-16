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

export async function updateTodo(id: string, patch: Partial<Pick<Todo, 'title' | 'status' | 'type' | 'due_date'>>): Promise<boolean> {
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

/** Sync auto todos from today's mission (new practice + review chapters). Removes stale, adds missing. */
export async function syncAutoTodos(
  userId: string,
  newChapters: TodayMissionChapter[],
  reviewChapters: ChapterReviewInfo[],
): Promise<Todo[]> {
  if (!supabase) return [];

  const { data: existing } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .eq('auto_generated', true);

  const existingRows = (existing ?? []) as Todo[];

  // Build sets of current mission chapter IDs by type
  const newIds = new Set(newChapters.map((c) => c.id));
  const reviewIds = new Set(reviewChapters.map((c) => c.chapterId));
  const allReviewChapterIds = reviewChapters.map((c) => c.chapterId).join(',');

  // Remove stale auto-todos whose chapter is no longer in today's mission
  const stale = existingRows.filter((r) => {
    if (!r.chapter_id) return false;
    if (r.type === 'review') return !reviewIds.has(r.chapter_id);
    if (r.type === 'practice') return !newIds.has(r.chapter_id);
    return false;
  });
  if (stale.length > 0) {
    await supabase.from('todos').delete().in('id', stale.map((r) => r.id));
  }

  const existingChapterIds = new Set(
    existingRows.filter((r) => r.chapter_id).map((r) => r.chapter_id as string),
  );

  const toInsert: object[] = [];

  // New practice chapters
  for (const ch of newChapters) {
    if (!existingChapterIds.has(ch.id)) {
      toInsert.push({
        user_id: userId,
        title: ch.name,
        status: 'new' as TodoStatus,
        type: 'practice' as TodoType,
        chapter_id: ch.id,
        chapter_ids: ch.id,
        auto_generated: true,
      });
    }
  }

  // Review chapters
  for (const ch of reviewChapters) {
    if (!existingChapterIds.has(ch.chapterId)) {
      toInsert.push({
        user_id: userId,
        title: ch.chapterName,
        status: 'new' as TodoStatus,
        type: 'review' as TodoType,
        chapter_id: ch.chapterId,
        chapter_ids: allReviewChapterIds,
        auto_generated: true,
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
