"use client";

import { supabase } from './supabase';
import type { ChapterReviewInfo } from './smart-planner';

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

/** Auto-add due review chapters as todos, remove stale ones, skip already-present ones. */
export async function syncAutoTodos(userId: string, dueChapters: ChapterReviewInfo[]): Promise<Todo[]> {
  if (!supabase) return [];

  // Fetch existing auto todos
  const { data: existing } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .eq('auto_generated', true);

  const existingRows = (existing ?? []) as Todo[];
  const dueIds = new Set(dueChapters.map((c) => c.chapterId));
  const allChapterIds = dueChapters.map((c) => c.chapterId).join(',');

  // Delete stale auto-todos (chapter no longer due)
  const stale = existingRows.filter((r) => r.chapter_id && !dueIds.has(r.chapter_id));
  if (stale.length > 0) {
    await supabase.from('todos').delete().in('id', stale.map((r) => r.id));
  }

  // Add new due chapters not already in todos
  const existingChapterIds = new Set(
    existingRows.filter((r) => r.chapter_id).map((r) => r.chapter_id as string),
  );
  const toAdd = dueChapters.filter((c) => !existingChapterIds.has(c.chapterId));

  if (toAdd.length > 0) {
    await supabase.from('todos').insert(
      toAdd.map((c) => ({
        user_id: userId,
        title: c.chapterName,
        status: 'new' as TodoStatus,
        type: 'review' as TodoType,
        chapter_id: c.chapterId,
        chapter_ids: allChapterIds,
        auto_generated: true,
      })),
    );
  }

  // Return fresh list
  const { data: fresh } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (fresh ?? []) as Todo[];
}
