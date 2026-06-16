"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ChapterReviewInfo } from '@/lib/smart-planner';

type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  chapterId?: string;   // set for auto-generated review tasks
  chapterIds?: string;  // comma-joined IDs for the create link
};

const STORAGE_KEY = 'passbar_todos';

function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TodoItem[]) : [];
  } catch {
    return [];
  }
}

function saveTodos(items: TodoItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function TodoWidget({ dueChapters }: { dueChapters: ChapterReviewInfo[] }) {
  const { t } = useI18n();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setItems(loadTodos());
  }, []);

  // Auto-sync due review chapters
  useEffect(() => {
    if (dueChapters.length === 0) return;

    setItems((prev) => {
      const next = [...prev];

      // Remove stale auto-tasks whose chapter is no longer due
      const dueIds = new Set(dueChapters.map((c) => c.chapterId));
      const filtered = next.filter((item) => !item.chapterId || dueIds.has(item.chapterId));

      // Add new due chapters not already in list
      const existingChapterIds = new Set(filtered.map((i) => i.chapterId).filter(Boolean));
      const allChapterIds = dueChapters.map((c) => c.chapterId).join(',');

      for (const ch of dueChapters) {
        if (!existingChapterIds.has(ch.chapterId)) {
          filtered.push({
            id: `review-${ch.chapterId}`,
            text: `${t('todo.reviewLabel')}: ${ch.chapterName}`,
            done: false,
            chapterId: ch.chapterId,
            chapterIds: allChapterIds,
          });
        }
      }

      saveTodos(filtered);
      return filtered;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueChapters]);

  const toggle = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.map((item) => item.id === id ? { ...item, done: !item.done } : item);
      saveTodos(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      saveTodos(next);
      return next;
    });
  }, []);

  const addItem = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setItems((prev) => {
      const next = [...prev, { id: `manual-${Date.now()}`, text, done: false }];
      saveTodos(next);
      return next;
    });
    setInput('');
    inputRef.current?.focus();
  }, [input]);

  const clearDone = useCallback(() => {
    setItems((prev) => {
      const next = prev.filter((item) => !item.done);
      saveTodos(next);
      return next;
    });
  }, []);

  const doneCount = items.filter((i) => i.done).length;

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            {t('todo.title')}
          </CardTitle>
          {doneCount > 0 && (
            <button
              onClick={clearDone}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />
              {t('todo.clearDone')}
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-1 pb-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">{t('todo.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 group"
              >
                <button
                  onClick={() => toggle(item.id)}
                  className={cn(
                    'shrink-0 transition-colors',
                    item.done ? 'text-primary' : 'text-muted-foreground/50 hover:text-primary/60',
                  )}
                  aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
                >
                  {item.done
                    ? <CheckCircle2 className="h-4 w-4" />
                    : <Circle className="h-4 w-4" />}
                </button>

                {item.chapterId ? (
                  <Link
                    href={`/create?chapters=${encodeURIComponent(item.chapterIds ?? item.chapterId)}`}
                    className={cn(
                      'flex-1 text-sm flex items-center gap-1.5 min-w-0',
                      item.done ? 'line-through text-muted-foreground' : 'text-foreground hover:text-primary',
                    )}
                  >
                    <RotateCcw className="h-3 w-3 shrink-0 text-blue-500" />
                    <span className="truncate">{item.text}</span>
                  </Link>
                ) : (
                  <span
                    className={cn(
                      'flex-1 text-sm truncate',
                      item.done ? 'line-through text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {item.text}
                  </span>
                )}

                <button
                  onClick={() => remove(item.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add task input */}
        <div className="flex gap-2 pt-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder={t('todo.addPlaceholder')}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button size="sm" variant="outline" onClick={addItem} disabled={!input.trim()} className="shrink-0 px-2.5">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
