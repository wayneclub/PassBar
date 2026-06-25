"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import {
  ArrowUpDown, BookOpen, CalendarIcon, CheckCircle2, ChevronDown, Circle, ChevronsUpDown,
  Kanban, LayoutList, Loader2, MoveDown, MoveUp, Pencil, Plus, RotateCcw, Search, Trash2, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select as ShadSelect,
  SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ActiveFilterBadges, FilterButton, FilterPanel,
  clearFilters, countActive, initFilterState, toggleFilter,
  type FilterGroup, type FilterState,
} from '@/components/FilterPanel';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  addChapterAsTodo, createTodo, deleteTodo, fetchTodos, updateTodo,
  type CreateTodoInput, type Todo, type TodoStatus, type TodoType,
} from '@/lib/todos';
import { fetchTodayMissionForUser, type TodayMissionChapter, type ChapterReviewInfo } from '@/lib/smart-planner';
import { getMbeChineseLabel } from '@/lib/mbe-labels';
import TaskDialog from '@/components/TaskDialog';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUSES: TodoStatus[] = ['new', 'scheduled', 'in_progress', 'completed'];
const TYPES: TodoType[] = ['manual', 'review', 'practice'];

const STATUS_KEY: Record<TodoStatus, string> = {
  new: 'tasks.statusNew',
  scheduled: 'tasks.statusScheduled',
  in_progress: 'tasks.statusInProgress',
  completed: 'tasks.statusCompleted',
};

const TYPE_KEY: Record<TodoType, string> = {
  manual: 'tasks.typeOperational',
  review: 'tasks.typeReview',
  practice: 'tasks.typePractice',
};

const STATUS_ICON: Record<TodoStatus, React.ReactNode> = {
  new: <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />,
  scheduled: <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />,
  in_progress: <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
};

const STATUS_BADGE: Record<TodoStatus, string> = {
  new: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-orange-100 text-orange-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

const STATUS_COLUMN_BG: Record<TodoStatus, string> = {
  new: 'bg-slate-50',
  scheduled: 'bg-amber-50/60',
  in_progress: 'bg-blue-50/60',
  completed: 'bg-slate-50/40',
};

const STATUS_COLUMN_ACCENT: Record<TodoStatus, string> = {
  new: 'border-t-2 border-t-slate-300',
  scheduled: 'border-t-2 border-t-amber-400',
  in_progress: 'border-t-2 border-t-blue-500',
  completed: 'border-t-2 border-t-green-500',
};

const STATUS_COUNT_BADGE: Record<TodoStatus, string> = {
  new: 'bg-slate-200 text-slate-600',
  scheduled: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

const STATUS_CARD_BG: Record<TodoStatus, string> = {
  new: 'bg-sky-100 border-sky-200/80',
  scheduled: 'bg-orange-100 border-orange-200/80',
  in_progress: 'bg-blue-100 border-blue-200/80',
  completed: 'bg-white/80 border-slate-200',
};

const TYPE_BADGE: Record<TodoType, string> = {
  manual: 'bg-slate-100 text-slate-500 border-slate-200',
  review: 'bg-blue-100 text-blue-600 border-blue-200',
  practice: 'bg-purple-100 text-purple-600 border-purple-200',
};

type T = ReturnType<typeof useI18n>['t'];

// ─── Badge helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status, t }: { status: TodoStatus; t: T }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_BADGE[status])}>
      {STATUS_ICON[status]}
      {t(STATUS_KEY[status] as Parameters<T>[0])}
    </span>
  );
}

function TypeBadge({ type, t }: { type: TodoType; t: T }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border', TYPE_BADGE[type])}>
      {type === 'review' && <RotateCcw className="h-3 w-3" />}
      {t(TYPE_KEY[type] as Parameters<T>[0])}
    </span>
  );
}

function AutoTag({ t }: { t: T }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
      {t('tasks.autoTag')}
    </span>
  );
}

// ─── Inline Row ───────────────────────────────────────────────────────────────

function InlineRow({
  todo, onStatusChange, onTypeChange, onTitleChange, onDueDateChange, onDelete, onEdit, t,
}: {
  todo: Todo;
  onStatusChange: (id: string, s: TodoStatus) => void;
  onTypeChange: (id: string, type: TodoType) => void;
  onTitleChange: (id: string, title: string) => void;
  onDueDateChange: (id: string, date: string | null) => void;
  onDelete: (id: string) => void;
  onEdit?: (todo: Todo) => void;
  t: T;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const commitTitle = () => {
    const v = titleDraft.trim();
    if (v && v !== todo.title) onTitleChange(todo.id, v);
    else setTitleDraft(todo.title);
    setEditingTitle(false);
  };

  const startEditTitle = (e: React.MouseEvent) => {
    if (todo.type !== 'manual') return; // only free-input (manual) titles are editable
    e.stopPropagation();
    setTitleDraft(todo.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 20);
  };

  const dueDateObj = todo.due_date ? new Date(todo.due_date) : undefined;

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-muted/20 group">
      {/* Checkbox */}
      <td className="py-3 pl-4 w-8">
        <button
          onClick={() => onStatusChange(todo.id, todo.status === 'completed' ? 'new' : 'completed')}
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          {todo.status === 'completed'
            ? <CheckCircle2 className="h-4 w-4 text-green-500" />
            : <Circle className="h-4 w-4" />}
        </button>
      </td>

      {/* Title — click to edit inline */}
      <td className="py-2 pl-2 pr-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
            {editingTitle ? (
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') { setTitleDraft(todo.title); setEditingTitle(false); }
                }}
                className="flex-1 min-w-0 rounded border border-primary/40 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            ) : todo.type !== 'manual' ? (
              todo.chapter_ids ? (
                <Link
                  href={`/create?chapters=${encodeURIComponent(todo.chapter_ids)}`}
                  className={cn(
                    'text-sm hover:text-primary transition-colors',
                    todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {todo.title}
                </Link>
              ) : (
                <span
                  className={cn(
                    'text-sm',
                    todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {todo.title}
                </span>
              )
            ) : (
              <span
                onClick={startEditTitle}
                title="Click to edit"
                className={cn(
                  'text-sm cursor-text rounded px-1 -mx-1 hover:bg-slate-100 transition-colors',
                  todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground',
                )}
              >
                {todo.title}
              </span>
            )}
            {todo.auto_generated && <AutoTag t={t} />}
            {/* Mobile metadata */}
            <div
              className="sm:hidden flex items-center gap-2 mt-1.5 w-full cursor-pointer hover:bg-slate-50/50 py-1 -mx-1 px-1 rounded transition-colors"
              onClick={() => onEdit?.(todo)}
            >
              <StatusBadge status={todo.status} t={t} />
              <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap", TYPE_BADGE[todo.type])}>
                {t(TYPE_KEY[todo.type] as Parameters<typeof t>[0])}
              </span>
              {dueDateObj && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto">
                  <CalendarIcon className="h-3 w-3" />
                  {format(dueDateObj, 'MM/dd')}
                </span>
              )}
            </div>
          </div>
          {/* Edit — hover only, shown for chapter tasks on desktop */}
          {onEdit && todo.chapter_id && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(todo); }}
              className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground/40 hover:text-primary transition-all hidden sm:block"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Delete — hover only, inline with title */}
          <button
            onClick={() => onDelete(todo.id)}
            className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground/40 hover:text-destructive transition-all ml-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>

      {/* Status — shadcn Select with badge trigger */}
      <td className="py-3 pr-4 whitespace-nowrap hidden sm:table-cell">
        <ShadSelect value={todo.status} onValueChange={(v) => onStatusChange(todo.id, v as TodoStatus)}>
          <SelectTrigger className={cn(
            'h-7 rounded-full pl-2.5 pr-2 text-xs font-medium border-0 shadow-none focus:ring-1 focus:ring-primary/40 gap-1.5 min-w-[6rem] w-auto',
            STATUS_BADGE[todo.status],
          )}>
            {STATUS_ICON[todo.status]}
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-[9rem]">
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} textValue={t(STATUS_KEY[s] as Parameters<T>[0])}>
                <span className="flex items-center gap-2 text-sm">
                  {STATUS_ICON[s]}
                  {t(STATUS_KEY[s] as Parameters<T>[0])}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </ShadSelect>
      </td>

      {/* Type — shadcn Select with badge trigger */}
      <td className="py-3 pr-4 whitespace-nowrap hidden md:table-cell">
        <ShadSelect value={todo.type} onValueChange={(v) => onTypeChange(todo.id, v as TodoType)}>
          <SelectTrigger className={cn(
            'h-7 rounded-full px-3 text-xs font-medium shadow-none focus:ring-1 focus:ring-primary/40 gap-1.5 min-w-[5rem] w-auto',
            TYPE_BADGE[todo.type],
          )}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-[7rem]">
            {TYPES.map((type) => (
              <SelectItem key={type} value={type} textValue={t(TYPE_KEY[type] as Parameters<T>[0])}>
                <span className="text-sm">{t(TYPE_KEY[type] as Parameters<T>[0])}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </ShadSelect>
      </td>

      {/* Due date — Popover + Calendar */}
      <td className="py-3 pr-4 whitespace-nowrap hidden lg:table-cell">
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-slate-100 -ml-2',
              dueDateObj ? 'text-slate-700' : 'text-muted-foreground',
            )}>
              <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
              {dueDateObj ? format(dueDateObj, 'yyyy/MM/dd') : '—'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dueDateObj}
              onSelect={(date) => {
                if (date) {
                  const d = new Date(date);
                  d.setHours(23, 59, 59, 999);
                  onDueDateChange(todo.id, d.toISOString());
                } else {
                  onDueDateChange(todo.id, null);
                }
              }}
              initialFocus
            />
            {dueDateObj && (
              <div className="border-t p-2">
                <button
                  onClick={() => onDueDateChange(todo.id, null)}
                  className="w-full text-xs text-muted-foreground hover:text-destructive text-center py-1 transition-colors"
                >
                  {t('tasks.clearDate')}
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </td>

    </tr>
  );
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortKey = 'title' | 'status' | 'type' | 'due_date';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<TodoStatus, number> = { new: 0, scheduled: 1, in_progress: 2, completed: 3 };
const TYPE_ORDER: Record<TodoType, number> = { manual: 0, review: 1, practice: 2 };

function sortTodos(todos: Todo[], key: SortKey | null, dir: SortDir): Todo[] {
  if (!key) return todos;
  return [...todos].sort((a, b) => {
    let cmp = 0;
    if (key === 'title') cmp = a.title.localeCompare(b.title);
    else if (key === 'status') cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else if (key === 'type') cmp = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    else if (key === 'due_date') {
      const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      cmp = da - db;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function SortIcon({ colKey, sortKey, sortDir }: { colKey: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== colKey) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return sortDir === 'asc' ? <MoveUp className="h-3 w-3 text-primary" /> : <MoveDown className="h-3 w-3 text-primary" />;
}

// ─── Table Section ────────────────────────────────────────────────────────────

function TableSection({
  label, count, todos, onStatusChange, onTypeChange, onTitleChange, onDueDateChange, onDelete, onEdit,
  countClass = 'bg-primary/10 text-primary', defaultOpen = true, t,
}: {
  label: string; count: number; todos: Todo[];
  onStatusChange: (id: string, s: TodoStatus) => void;
  onTypeChange: (id: string, type: TodoType) => void;
  onTitleChange: (id: string, title: string) => void;
  onDueDateChange: (id: string, date: string | null) => void;
  onDelete: (id: string) => void;
  onEdit?: (todo: Todo) => void;
  countClass?: string; defaultOpen?: boolean; t: T;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => sortTodos(todos, sortKey, sortDir), [todos, sortKey, sortDir]);

  const ColHeader = ({ colKey, label: colLabel, className }: { colKey: SortKey; label: string; className?: string }) => (
    <th className={cn('py-2 pr-4 text-left text-xs font-medium text-muted-foreground whitespace-nowrap', className)}>
      <button
        onClick={() => handleSort(colKey)}
        className={cn(
          'flex items-center gap-1 hover:text-slate-700 transition-colors',
          sortKey === colKey && 'text-primary font-semibold',
        )}
      >
        {colLabel}
        <SortIcon colKey={colKey} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </th>
  );

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform shrink-0', open ? 'rotate-0' : '-rotate-90')} />
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', countClass)}>{count}</span>
        {sortKey && (
          <span className="ml-auto flex items-center gap-1 text-xs text-primary font-medium">
            <ArrowUpDown className="h-3 w-3" />
            {sortDir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="w-8 py-2 pl-4" />
                <ColHeader colKey="title" label={t('tasks.colTask')} className="pl-2" />
                <ColHeader colKey="status" label={t('tasks.colStatus')} className="hidden sm:table-cell" />
                <ColHeader colKey="type" label={t('tasks.colType')} className="hidden md:table-cell" />
                <ColHeader colKey="due_date" label={t('tasks.colDueDate')} className="hidden lg:table-cell" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    {t('tasks.noTasks')}
                  </td>
                </tr>
              ) : sorted.map((todo) => (
                <InlineRow
                  key={todo.id}
                  todo={todo}
                  onStatusChange={onStatusChange}
                  onTypeChange={onTypeChange}
                  onTitleChange={onTitleChange}
                  onDueDateChange={onDueDateChange}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TableView({
  todos, onStatusChange, onTypeChange, onTitleChange, onDueDateChange, onDelete, onEdit, t,
}: {
  todos: Todo[];
  onStatusChange: (id: string, s: TodoStatus) => void;
  onTypeChange: (id: string, type: TodoType) => void;
  onTitleChange: (id: string, title: string) => void;
  onDueDateChange: (id: string, date: string | null) => void;
  onDelete: (id: string) => void;
  onEdit?: (todo: Todo) => void;
  t: T;
}) {
  const active = todos.filter((todo) => todo.status !== 'completed');
  const done = todos.filter((todo) => todo.status === 'completed');

  return (
    <div className="space-y-4">
      <TableSection
        label={t('tasks.activeTasks')}
        count={active.length}
        todos={active}
        onStatusChange={onStatusChange}
        onTypeChange={onTypeChange}
        onTitleChange={onTitleChange}
        onDueDateChange={onDueDateChange}
        onDelete={onDelete}
        onEdit={onEdit}
        defaultOpen
        t={t}
      />
      <TableSection
        label={t('tasks.completedTasks')}
        count={done.length}
        todos={done}
        onStatusChange={onStatusChange}
        onTypeChange={onTypeChange}
        onTitleChange={onTitleChange}
        onDueDateChange={onDueDateChange}
        onDelete={onDelete}
        onEdit={onEdit}
        countClass="bg-green-100 text-green-700"
        defaultOpen={false}
        t={t}
      />
    </div>
  );
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────

function KanbanCard({
  todo, onStatusChange, onEdit, t,
}: {
  todo: Todo;
  onStatusChange: (id: string, s: TodoStatus) => void;
  onEdit: (todo: Todo) => void;
  t: T;
}) {
  const nextStatus = STATUSES[STATUSES.indexOf(todo.status) + 1] as TodoStatus | undefined;

  return (
    <div
      className={cn(
        'relative rounded-lg border p-3 shadow-sm group cursor-pointer transition-shadow hover:shadow-md',
        STATUS_CARD_BG[todo.status],
        todo.status === 'completed' && 'opacity-60',
      )}
      onClick={() => onEdit(todo)}
    >
      {/* Edit pencil */}
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(todo); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-primary transition-all"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {/* Title */}
      <div className="pr-5 mb-2">
        {todo.type !== 'manual' && todo.chapter_ids ? (
          <Link
            href={`/create?chapters=${encodeURIComponent(todo.chapter_ids)}`}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'text-sm font-medium leading-snug line-clamp-2 hover:text-primary transition-colors',
              todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-slate-800',
            )}
          >
            {todo.title}
          </Link>
        ) : (
          <p className={cn(
            'text-sm font-medium leading-snug line-clamp-2',
            todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-slate-800',
          )}>
            {todo.title}
          </p>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {todo.auto_generated && <AutoTag t={t} />}
          <TypeBadge type={todo.type} t={t} />
        </div>
        {todo.due_date && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <CalendarIcon className="h-3 w-3" />
            {format(new Date(todo.due_date), 'MM/dd')}
          </span>
        )}
      </div>

      {/* Advance status button */}
      {todo.status !== 'completed' && nextStatus && (
        <button
          onClick={(e) => { e.stopPropagation(); onStatusChange(todo.id, nextStatus); }}
          className="mt-2.5 w-full text-xs text-slate-500 hover:text-slate-800 bg-white/60 hover:bg-white/90 px-2.5 py-1 rounded-md border border-white/60 transition-colors font-medium text-center"
        >
          → {t(STATUS_KEY[nextStatus] as Parameters<T>[0])}
        </button>
      )}
      {todo.status === 'completed' && (
        <button
          onClick={(e) => { e.stopPropagation(); onStatusChange(todo.id, 'new'); }}
          className="mt-2.5 w-full text-xs text-slate-500 hover:text-slate-800 bg-white/60 hover:bg-white/90 px-2.5 py-1 rounded-md border border-white/60 transition-colors font-medium text-center"
        >
          {t('tasks.reopen')}
        </button>
      )}
    </div>
  );
}

// ─── Kanban View ─────────────────────────────────────────────────────────────

function KanbanView({
  todos, onStatusChange, onEdit, t,
}: {
  todos: Todo[];
  onStatusChange: (id: string, s: TodoStatus) => void;
  onEdit: (todo: Todo) => void;
  t: T;
}) {
  const [activeTab, setActiveTab] = useState<TodoStatus>('new');
  const byStatus = (s: TodoStatus) => todos.filter((todo) => todo.status === s);

  return (
    <>
      {/* Mobile: horizontal tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 sm:hidden scrollbar-none">
        {STATUSES.map((s) => {
          const count = byStatus(s).length;
          return (
            <button
              key={s}
              onClick={() => setActiveTab(s)}
              className={cn(
                'flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors border',
                activeTab === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-primary/50',
              )}
            >
              {t(STATUS_KEY[s] as Parameters<T>[0])}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                activeTab === s ? 'bg-white/20 text-primary-foreground' : 'bg-slate-100 text-slate-500',
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile: single active column */}
      <div className="sm:hidden">
        {(() => {
          const cols = byStatus(activeTab);
          return (
            <div className={cn('rounded-xl border border-slate-200 overflow-hidden', STATUS_COLUMN_BG[activeTab], STATUS_COLUMN_ACCENT[activeTab])}>
              <div className="p-3 space-y-2 min-h-24">
                {cols.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t('tasks.noTasks')}</p>
                )}
                {cols.map((todo) => (
                  <KanbanCard key={todo.id} todo={todo} onStatusChange={onStatusChange} onEdit={onEdit} t={t} />
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Desktop: 4-column grid */}
      <div className="hidden sm:grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {STATUSES.map((status) => {
          const cols = byStatus(status);
          return (
            <div key={status} className={cn('rounded-xl border border-slate-200 overflow-hidden', STATUS_COLUMN_BG[status], STATUS_COLUMN_ACCENT[status])}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/60 bg-white/60">
                <span className="text-sm font-semibold text-slate-700">{t(STATUS_KEY[status] as Parameters<T>[0])}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_COUNT_BADGE[status])}>
                  {cols.length}
                </span>
              </div>
              <div className="p-3 space-y-2 min-h-24">
                {cols.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">{t('tasks.noTasksShort')}</p>
                )}
                {cols.map((todo) => (
                  <KanbanCard key={todo.id} todo={todo} onStatusChange={onStatusChange} onEdit={onEdit} t={t} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ViewMode = 'table' | 'kanban';

export default function TasksPage() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  // Today's mission
  const [missionNew, setMissionNew] = useState<TodayMissionChapter[]>([]);
  const [missionReview, setMissionReview] = useState<ChapterReviewInfo[]>([]);
  const [addingChapter, setAddingChapter] = useState<Record<string, boolean>>({});

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { newChapters, reviewChapters } = await fetchTodayMissionForUser(user.id);
      setMissionNew(newChapters);
      setMissionReview(reviewChapters);
      const fresh = await fetchTodos(user.id);
      setTodos(fresh);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = useCallback(async (id: string, status: TodoStatus) => {
    setTodos((prev) => prev.map((todo) => todo.id === id ? { ...todo, status } : todo));
    await updateTodo(id, { status });
  }, []);

  const handleTypeChange = useCallback(async (id: string, type: TodoType) => {
    setTodos((prev) => prev.map((todo) => todo.id === id ? { ...todo, type } : todo));
    await updateTodo(id, { type });
  }, []);

  const handleTitleChange = useCallback(async (id: string, title: string) => {
    setTodos((prev) => prev.map((todo) => todo.id === id ? { ...todo, title } : todo));
    await updateTodo(id, { title });
  }, []);

  const handleDueDateChange = useCallback(async (id: string, due_date: string | null) => {
    setTodos((prev) => prev.map((todo) => todo.id === id ? { ...todo, due_date } : todo));
    await updateTodo(id, { due_date });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
    await deleteTodo(id);
  }, []);

  const handleSave = useCallback(async (input: CreateTodoInput) => {
    if (!user?.id) return;
    if (editingTodo) {
      // update existing
      await updateTodo(editingTodo.id, {
        title: input.title,
        status: input.status,
        type: input.type,
        due_date: input.due_date ?? null,
        chapter_id: input.chapter_id !== undefined ? input.chapter_id : editingTodo.chapter_id,
        chapter_ids: input.chapter_ids !== undefined ? input.chapter_ids : editingTodo.chapter_ids,
        note: input.note !== undefined ? input.note : editingTodo.note,
      });
      setTodos((prev) => prev.map((todo) =>
        todo.id === editingTodo.id
          ? {
              ...todo,
              title: input.title,
              status: input.status ?? todo.status,
              type: input.type ?? todo.type,
              due_date: input.due_date ?? null,
              chapter_id: input.chapter_id !== undefined ? input.chapter_id : todo.chapter_id,
              chapter_ids: input.chapter_ids !== undefined ? input.chapter_ids : todo.chapter_ids,
              note: input.note !== undefined ? input.note : todo.note,
            }
          : todo,
      ));
    } else {
      const created = await createTodo(user.id, input);
      if (created) setTodos((prev) => [created, ...prev]);
    }
  }, [user?.id, editingTodo]);

  const openAdd = () => { setEditingTodo(null); setDialogOpen(true); };
  const openEdit = (todo: Todo) => { setEditingTodo(todo); setDialogOpen(true); };

  const handleAddChapter = useCallback(async (
    id: string,
    name: string,
    subject: string,
    type: 'practice' | 'review',
    chapterIds?: string,
  ) => {
    if (!user?.id) return;
    
    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticTodo: Todo = {
      id: tempId,
      user_id: user.id,
      title: `${subject} · ${name}`,
      status: 'new',
      type,
      chapter_id: id,
      chapter_ids: chapterIds ?? id,
      note: null,
      auto_generated: false,
      due_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    setTodos((prev) => [optimisticTodo, ...prev]);
    setAddingChapter((prev) => ({ ...prev, [id]: true }));
    
    const created = await addChapterAsTodo(user.id, { id, name, subject, type, chapterIds });
    
    setTodos((prev) => {
      const filtered = prev.filter(t => t.id !== tempId);
      if (created) {
        return [created, ...filtered];
      }
      return filtered;
    });
    setAddingChapter((prev) => ({ ...prev, [id]: false }));
  }, [user?.id]);

  // ── Filter groups — use stable keys ('status', 'type'), labels only for display ──
  const FILTER_STATUS_KEY = 'status';
  const FILTER_TYPE_KEY = 'type';

  const filterGroups = useMemo((): FilterGroup[] => [
    {
      label: t('tasks.filterStatus'),
      options: STATUSES.map((s) => ({ value: s, label: t(STATUS_KEY[s] as Parameters<T>[0]) })),
    },
    {
      label: t('tasks.filterType'),
      options: TYPES.map((type) => ({ value: type, label: t(TYPE_KEY[type] as Parameters<T>[0]) })),
    },
  ], [t]);

  // Use stable (non-translated) keys so filterState never breaks on language change
  const [filterState, setFilterState] = useState<FilterState>(() => new Map([
    [FILTER_STATUS_KEY, new Set<string>()],
    [FILTER_TYPE_KEY, new Set<string>()],
  ]));

  // Map translated group labels → stable keys for FilterPanel callbacks
  const stableKey = useCallback((groupLabel: string): string => {
    if (groupLabel === t('tasks.filterStatus')) return FILTER_STATUS_KEY;
    if (groupLabel === t('tasks.filterType')) return FILTER_TYPE_KEY;
    return groupLabel;
  }, [t]);

  const handleToggleFilter = useCallback((groupLabel: string, value: string) => {
    setFilterState((prev) => toggleFilter(prev, stableKey(groupLabel), value));
  }, [stableKey]);

  const handleClearFilters = useCallback(() => {
    setFilterState(new Map([
      [FILTER_STATUS_KEY, new Set<string>()],
      [FILTER_TYPE_KEY, new Set<string>()],
    ]));
  }, []);

  // Map filterState back to translated-label keys for FilterPanel display
  const displayFilterState = useMemo((): FilterState => new Map([
    [t('tasks.filterStatus'), filterState.get(FILTER_STATUS_KEY) ?? new Set()],
    [t('tasks.filterType'), filterState.get(FILTER_TYPE_KEY) ?? new Set()],
  ]), [filterState, t]);

  const activeFilterCount = countActive(filterState);

  // Defer search so each keystroke updates the input instantly, filter runs after
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const statusSet = filterState.get(FILTER_STATUS_KEY)!;
    const typeSet = filterState.get(FILTER_TYPE_KEY)!;
    return todos.filter((todo) => {
      if (statusSet.size > 0 && !statusSet.has(todo.status)) return false;
      if (typeSet.size > 0 && !typeSet.has(todo.type)) return false;
      if (q && !todo.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [todos, deferredSearch, filterState]);

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <Button onClick={openAdd} className="hidden md:flex h-9 px-4 text-sm font-semibold gap-2 self-start md:self-auto">
          <Plus className="h-4 w-4" />
          {t('tasks.addNew')}
        </Button>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 overflow-x-auto shrink-0">
          <button
            onClick={() => setView('table')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors shrink-0',
              view === 'table' ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutList className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{t('tasks.tableView')}</span>
          </button>
          <button
            onClick={() => setView('kanban')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors shrink-0',
              view === 'kanban' ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Kanban className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{t('tasks.kanbanView')}</span>
          </button>
        </div>

        <div className="flex-1" />

        {/* Search + Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:flex-initial">
            <Search className="absolute left-3 h-3.5 w-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('tasks.searchPlaceholder')}
              className="h-9 w-full md:w-52 rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <FilterButton
            open={filterOpen}
            count={activeFilterCount}
            label={t('tasks.filter')}
            onClick={() => setFilterOpen((v) => !v)}
          />
        </div>
      </div>

      {/* Inline filter panel */}
      <FilterPanel
        open={filterOpen}
        groups={filterGroups}
        state={displayFilterState}
        onToggle={handleToggleFilter}
        onClear={handleClearFilters}
        clearLabel={t('tasks.filterAll')}
        filterLabel={t('tasks.filter')}
      />

      {/* Active filter badges */}
      <ActiveFilterBadges
        groups={filterGroups}
        state={displayFilterState}
        onToggle={handleToggleFilter}
        onClear={handleClearFilters}
        clearLabel={t('tasks.filterAll')}
      />

      {/* Today's mission panel */}
      {!loading && (missionNew.length > 0 || missionReview.length > 0) && (() => {
        const existingChapterIds = new Set(todos.filter((t) => t.chapter_id).map((t) => t.chapter_id as string));
        const allReviewIds = missionReview.map((c) => c.chapterId).join(',');

        const ChapterRow = ({ id, name, subject, type, chapterIds }: {
          id: string; name: string; subject: string; type: 'practice' | 'review'; chapterIds?: string;
        }) => {
          const added = existingChapterIds.has(id);
          const loading = addingChapter[id];
          const zhSubject = getMbeChineseLabel(subject, language);
          const zhName = getMbeChineseLabel(name, language);
          return (
            <div className="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-700 leading-snug">
                  {subject}{zhSubject ? `（${zhSubject}）` : ''}
                </p>
                <p className="text-xs text-muted-foreground leading-snug mt-1">
                  {name}{zhName ? `（${zhName}）` : ''}
                </p>
              </div>
              <button
                disabled={added || loading}
                onClick={() => handleAddChapter(id, name, subject, type, chapterIds)}
                className={cn(
                  'shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  added
                    ? 'bg-green-50 text-green-600 border border-green-200 cursor-default'
                    : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20',
                )}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : added ? (
                  <><CheckCircle2 className="h-3 w-3" />{t('tasks.alreadyAdded')}</>
                ) : (
                  <><Plus className="h-3 w-3" />{t('tasks.addToTodo')}</>
                )}
              </button>
            </div>
          );
        };

        return (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <span className="text-sm font-bold text-slate-800">{t('tasks.todayMission')}</span>
              <span className="text-xs text-muted-foreground">{t('tasks.todayMissionDesc')}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              {/* New practice */}
              <div className="p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">{t('tasks.missionNew')}</span>
                </div>
                {missionNew.length === 0
                  ? <p className="text-xs text-muted-foreground">{t('tasks.noMissionToday')}</p>
                  : missionNew.map((ch) => (
                    <ChapterRow key={ch.id} id={ch.id} name={ch.name} subject={ch.subject} type="practice" />
                  ))}
              </div>
              {/* Spaced review */}
              <div className="p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <RotateCcw className="h-3.5 w-3.5 text-orange-500" />
                  <span className="text-xs font-semibold text-orange-600 uppercase tracking-wide">{t('tasks.missionReview')}</span>
                </div>
                {missionReview.length === 0
                  ? <p className="text-xs text-muted-foreground">{t('tasks.noMissionToday')}</p>
                  : missionReview.map((ch) => (
                    <ChapterRow key={ch.chapterId} id={ch.chapterId} name={ch.chapterName} subject={ch.subject} type="review" chapterIds={allReviewIds} />
                  ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{t('tasks.loading')}</span>
        </div>
      ) : view === 'table' ? (
        <TableView
          todos={filtered}
          onStatusChange={handleStatusChange}
          onTypeChange={handleTypeChange}
          onTitleChange={handleTitleChange}
          onDueDateChange={handleDueDateChange}
          onDelete={handleDelete}
          onEdit={openEdit}
          t={t}
        />
      ) : (
        <KanbanView
          todos={filtered}
          onStatusChange={handleStatusChange}
          onEdit={openEdit}
          t={t}
        />
      )}

      {/* Mobile FAB */}
      <button
        onClick={openAdd}
        className="md:hidden fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#c29d4c] text-white shadow-lg shadow-[#c29d4c]/30 transition-transform active:scale-95"
      >
        <Plus className="h-7 w-7" />
      </button>

      {/* Add / Edit dialog */}
      <TaskDialog
        todo={editingTodo}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
