"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getSubjects } from '@/lib/question-bank';
import type { Subject } from '@/lib/types';
import {
  type Todo, type TodoStatus, type TodoType,
  type CreateTodoInput,
} from '@/lib/todos';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'manual' | 'chapter';

type FormState = {
  mode: Mode;
  title: string;
  status: TodoStatus;
  type: TodoType;
  due_date: string;
  subjectId: string;
  chapterId: string;
  chapterName: string;
  chapterMode: 'practice' | 'review';
  note: string;
};

const STATUSES: TodoStatus[] = ['new', 'scheduled', 'in_progress', 'completed'];
const STATUS_KEY: Record<TodoStatus, string> = {
  new: 'tasks.statusNew',
  scheduled: 'tasks.statusScheduled',
  in_progress: 'tasks.statusInProgress',
  completed: 'tasks.statusCompleted',
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  /** null = "add" dialog, Todo = "edit" dialog */
  todo: Todo | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: CreateTodoInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
};

// ─── Dialog ───────────────────────────────────────────────────────────────────

export default function TaskDialog({ todo, open, onClose, onSave, onDelete }: Props) {
  const { t } = useI18n();
  type T = typeof t;

  const [form, setForm] = useState<FormState>(defaultForm());
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const titleRef = useRef<HTMLInputElement>(null);

  function defaultForm(): FormState {
    return {
      mode: 'manual',
      title: '',
      status: 'new',
      type: 'manual',
      due_date: '',
      subjectId: '',
      chapterId: '',
      chapterName: '',
      chapterMode: 'practice',
      note: '',
    };
  }

  const isChapterTask = !!(todo?.chapter_id);

  // Populate form when editing
  useEffect(() => {
    if (!open) return;
    if (todo) {
      setForm({
        mode: isChapterTask ? 'chapter' : 'manual',
        title: todo.title,
        status: todo.status,
        type: todo.type,
        due_date: todo.due_date ? todo.due_date.slice(0, 10) : '',
        subjectId: '',
        chapterId: todo.chapter_id ?? '',
        chapterName: todo.title,
        chapterMode: todo.type === 'review' ? 'review' : 'practice',
        note: todo.note ?? '',
      });
    } else {
      setForm(defaultForm());
    }
    setErrors({});
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open, todo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load subjects when chapter mode is active
  useEffect(() => {
    if (form.mode !== 'chapter' || subjects.length > 0) return;
    setLoadingSubjects(true);
    getSubjects().then((s) => {
      setSubjects(s);
      setLoadingSubjects(false);
    });
  }, [form.mode, subjects.length]);

  // After subjects load in edit mode, resolve subjectId from chapterId
  useEffect(() => {
    if (!isChapterTask || !todo?.chapter_id || subjects.length === 0 || form.subjectId) return;
    const found = subjects.find((s) => s.chapters.some((c) => c.id === todo.chapter_id));
    if (found) setForm((prev) => ({ ...prev, subjectId: found.id }));
  }, [subjects, isChapterTask, todo?.chapter_id, form.subjectId]);

  const selectedSubject = subjects.find((s) => s.id === form.subjectId);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (form.mode === 'manual' && !form.title.trim()) {
      errs.title = t('tasks.titleRequired');
    }
    if (form.mode === 'chapter' && !form.chapterId) {
      errs.chapterId = t('tasks.chapterRequired');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      let input: CreateTodoInput;
      if (form.mode === 'chapter') {
        const chapter = selectedSubject?.chapters.find((c) => c.id === form.chapterId);
        const subjectName = selectedSubject?.name ?? '';
        const chapterName = chapter?.name ?? form.chapterName;
        input = {
          title: subjectName ? `${subjectName} · ${chapterName}` : chapterName,
          status: form.status,
          type: form.chapterMode === 'review' ? 'review' : 'practice',
          due_date: form.due_date ? new Date(form.due_date + 'T23:59:59').toISOString() : null,
          chapter_id: form.chapterId || null,
          chapter_ids: form.chapterId || null,
          note: form.note.trim() || null,
          auto_generated: false,
        };
      } else {
        input = {
          title: form.title.trim(),
          status: form.status,
          type: form.type,
          due_date: form.due_date ? new Date(form.due_date + 'T23:59:59').toISOString() : null,
          note: form.note.trim() || null,
        };
      }
      await onSave(input);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!todo || !onDelete) return;
    if (!window.confirm(t('tasks.confirmDelete'))) return;
    setDeleting(true);
    try {
      await onDelete(todo.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white w-full sm:w-[480px] sm:rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 overflow-hidden max-h-[90dvh] flex flex-col rounded-t-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-slate-50 shrink-0">
          <h2 className="text-base font-semibold text-slate-800">
            {todo ? t('tasks.editTaskTitle') : t('tasks.addTaskTitle')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1">
            {(['manual', 'chapter'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => set('mode', m)}
                className={cn(
                  'flex-1 rounded-md py-2 text-xs font-medium transition-colors',
                  form.mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'manual' ? t('tasks.modeManual') : t('tasks.modeChapter')}
              </button>
            ))}
          </div>

          {/* Manual mode fields */}
          {form.mode === 'manual' && (
            <Field label={t('tasks.fieldTitle')} error={errors.title}>
              <input
                ref={titleRef}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder={t('tasks.fieldTitlePlaceholder')}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all',
                  errors.title ? 'border-red-400' : 'border-slate-200',
                )}
              />
            </Field>
          )}

          {/* Chapter mode fields */}
          {form.mode === 'chapter' && (
            <>
              {loadingSubjects ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <Field label={t('tasks.fieldSubject')}>
                    <select
                      value={form.subjectId}
                      onChange={(e) => { set('subjectId', e.target.value); set('chapterId', ''); }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
                    >
                      <option value="">{t('tasks.selectSubject')}</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t('tasks.fieldChapter')} error={errors.chapterId}>
                    <select
                      value={form.chapterId}
                      onChange={(e) => set('chapterId', e.target.value)}
                      disabled={!form.subjectId}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 disabled:opacity-50',
                        errors.chapterId ? 'border-red-400' : 'border-slate-200',
                      )}
                    >
                      <option value="">{t('tasks.selectChapter')}</option>
                      {(selectedSubject?.chapters ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t('tasks.fieldChapterMode')}>
                    <div className="flex gap-2">
                      {(['practice', 'review'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => set('chapterMode', m)}
                          className={cn(
                            'flex-1 rounded-lg border py-2 text-xs font-medium transition-colors',
                            form.chapterMode === m
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50',
                          )}
                        >
                          {m === 'practice' ? t('tasks.chapterModePractice') : t('tasks.chapterModeReview')}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </>
          )}

          {/* Shared fields */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('tasks.fieldStatus')}>
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value as TodoStatus)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(STATUS_KEY[s] as Parameters<T>[0])}</option>
                ))}
              </select>
            </Field>

            {form.mode === 'manual' && (
              <Field label={t('tasks.fieldType')}>
                <select
                  value={form.type}
                  onChange={(e) => set('type', e.target.value as TodoType)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="manual">{t('tasks.typeOperational')}</option>
                  <option value="review">{t('tasks.typeReview')}</option>
                  <option value="practice">{t('tasks.typePractice')}</option>
                </select>
              </Field>
            )}

            <Field label={t('tasks.fieldDueDate')} className={form.mode === 'chapter' ? 'col-span-2' : ''}>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => set('due_date', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
          </div>

          <Field label={t('tasks.fieldNote')}>
            <textarea
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder={t('tasks.fieldNotePlaceholder')}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 resize-none"
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t bg-slate-50 shrink-0">
          {todo && onDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t('tasks.deleteTask')}
            </button>
          )}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {t('tasks.cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="min-w-16">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('tasks.saveTask')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label, error, children, className,
}: {
  label: string; error?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
