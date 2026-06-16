"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, Circle, GanttChartSquare, Kanban, LayoutList,
  Loader2, Plus, RotateCcw, Trash2, X,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  createTodo, deleteTodo, fetchTodos, syncAutoTodos, updateTodo,
  type Todo, type TodoStatus, type TodoType,
} from '@/lib/todos';
import { fetchDueReviewChaptersForUser } from '@/lib/smart-planner';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUSES: TodoStatus[] = ['new', 'scheduled', 'in_progress', 'completed'];

const STATUS_LABEL: Record<TodoStatus, string> = {
  new: 'New task',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const STATUS_BADGE: Record<TodoStatus, string> = {
  new: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-orange-100 text-orange-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

const STATUS_COLUMN_BG: Record<TodoStatus, string> = {
  new: 'bg-blue-50',
  scheduled: 'bg-orange-50',
  in_progress: 'bg-sky-50',
  completed: 'bg-slate-50',
};

const STATUS_CARD_BG: Record<TodoStatus, string> = {
  new: 'bg-blue-100/60 border-blue-200',
  scheduled: 'bg-orange-100/60 border-orange-200',
  in_progress: 'bg-sky-100/60 border-sky-200',
  completed: 'bg-slate-100/50 border-slate-200 opacity-70',
};

const TYPE_BADGE: Record<TodoType, string> = {
  manual: 'bg-slate-100 text-slate-500',
  review: 'bg-blue-100 text-blue-600',
  practice: 'bg-purple-100 text-purple-600',
};

const TYPE_LABEL: Record<TodoType, string> = {
  manual: 'Task',
  review: 'Review',
  practice: 'Practice',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TodoStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', STATUS_BADGE[status])}>
      {status === 'completed' && <CheckCircle2 className="h-3 w-3" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function TypeBadge({ type }: { type: TodoType }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TYPE_BADGE[type])}>
      {type === 'review' && <RotateCcw className="h-3 w-3 mr-1" />}
      {TYPE_LABEL[type]}
    </span>
  );
}

function StatusSelect({ value, onChange }: { value: TodoStatus; onChange: (s: TodoStatus) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TodoStatus)}
      onClick={(e) => e.stopPropagation()}
      className="rounded-full border-0 bg-transparent text-xs font-medium focus:outline-none focus:ring-0 cursor-pointer"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
      ))}
    </select>
  );
}

// ─── Add row / inline input ───────────────────────────────────────────────────

function AddTaskRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onAdd(t);
    setValue('');
    inputRef.current?.focus();
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-dashed border-slate-200">
      <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Add a task..."
        className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
      />
      {value.trim() && (
        <Button size="sm" className="h-7 px-3 text-xs" onClick={submit}>Add</Button>
      )}
    </div>
  );
}

// ─── Table View ──────────────────────────────────────────────────────────────

function TableView({
  todos,
  onStatusChange,
  onDelete,
  onAdd,
}: {
  todos: Todo[];
  onStatusChange: (id: string, s: TodoStatus) => void;
  onDelete: (id: string) => void;
  onAdd: (title: string) => void;
}) {
  const active = todos.filter((t) => t.status !== 'completed');
  const done = todos.filter((t) => t.status === 'completed');

  const renderRows = (rows: Todo[]) =>
    rows.map((todo) => (
      <tr key={todo.id} className="border-b border-slate-100 hover:bg-muted/30 group">
        <td className="py-3 pl-4 pr-2 w-8">
          <button
            onClick={() => onStatusChange(todo.id, todo.status === 'completed' ? 'new' : 'completed')}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            {todo.status === 'completed'
              ? <CheckCircle2 className="h-4 w-4 text-primary" />
              : <Circle className="h-4 w-4" />}
          </button>
        </td>
        <td className="py-3 pr-4 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {todo.type === 'review' && todo.chapter_ids ? (
              <Link
                href={`/create?chapters=${encodeURIComponent(todo.chapter_ids)}`}
                className={cn(
                  'text-sm truncate hover:text-primary transition-colors',
                  todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground',
                )}
              >
                {todo.title}
              </Link>
            ) : (
              <span className={cn(
                'text-sm truncate',
                todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground',
              )}>
                {todo.title}
              </span>
            )}
            {todo.auto_generated && (
              <span className="shrink-0 text-xs text-blue-500 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">Auto</span>
            )}
          </div>
        </td>
        <td className="py-3 pr-4 whitespace-nowrap">
          <div className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', STATUS_BADGE[todo.status])}>
            {todo.status === 'completed' && <CheckCircle2 className="h-3 w-3" />}
            <StatusSelect value={todo.status} onChange={(s) => onStatusChange(todo.id, s)} />
          </div>
        </td>
        <td className="py-3 pr-4 whitespace-nowrap">
          <TypeBadge type={todo.type} />
        </td>
        <td className="py-3 pr-4 whitespace-nowrap text-sm text-muted-foreground">
          {todo.due_date ? new Date(todo.due_date).toLocaleDateString() : '—'}
        </td>
        <td className="py-3 pr-4 w-8">
          <button
            onClick={() => onDelete(todo.id)}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>
    ));

  const headerCells = ['', 'Task', 'Status', 'Type', 'Due date', ''];

  return (
    <div className="space-y-6">
      {/* Active */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <span className="text-sm font-semibold text-slate-800">Active tasks</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{active.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {headerCells.map((h, i) => (
                  <th key={i} className="py-2 pl-4 pr-4 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No active tasks.
                  </td>
                </tr>
              ) : renderRows(active)}
            </tbody>
          </table>
        </div>
        <AddTaskRow onAdd={onAdd} />
      </div>

      {/* Completed */}
      {done.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
            <span className="text-sm font-semibold text-slate-800">Completed tasks</span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{done.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {headerCells.map((h, i) => (
                    <th key={i} className="py-2 pl-4 pr-4 text-left text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{renderRows(done)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────

function KanbanCard({
  todo,
  onStatusChange,
  onDelete,
}: {
  todo: Todo;
  onStatusChange: (id: string, s: TodoStatus) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={cn('relative rounded-xl border p-3 shadow-sm group', STATUS_CARD_BG[todo.status])}>
      <button
        onClick={() => onDelete(todo.id)}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="pr-5 mb-2">
        {todo.type === 'review' && todo.chapter_ids ? (
          <Link
            href={`/create?chapters=${encodeURIComponent(todo.chapter_ids)}`}
            className="text-sm font-medium text-slate-800 hover:text-primary leading-snug line-clamp-2"
          >
            {todo.title}
          </Link>
        ) : (
          <p className={cn('text-sm font-medium leading-snug line-clamp-2', todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-slate-800')}>
            {todo.title}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <TypeBadge type={todo.type} />
        {todo.auto_generated && (
          <span className="text-xs text-blue-500 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">Auto</span>
        )}
        {todo.due_date && (
          <span className="text-xs text-muted-foreground">{new Date(todo.due_date).toLocaleDateString()}</span>
        )}
      </div>

      {/* Move to next status */}
      {todo.status !== 'completed' && (
        <div className="mt-2 flex gap-1">
          {STATUSES.filter((s) => s !== todo.status && s !== 'new').map((s) => (
            <button
              key={s}
              onClick={() => onStatusChange(todo.id, s)}
              className="text-xs text-muted-foreground hover:text-foreground bg-white/60 hover:bg-white px-2 py-0.5 rounded-full border border-slate-200 transition-colors"
            >
              → {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      {todo.status === 'completed' && (
        <button
          onClick={() => onStatusChange(todo.id, 'new')}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground bg-white/60 hover:bg-white px-2 py-0.5 rounded-full border border-slate-200 transition-colors"
        >
          ↩ Reopen
        </button>
      )}
    </div>
  );
}

// ─── Kanban View ─────────────────────────────────────────────────────────────

function KanbanView({
  todos,
  onStatusChange,
  onDelete,
  onAdd,
}: {
  todos: Todo[];
  onStatusChange: (id: string, s: TodoStatus) => void;
  onDelete: (id: string) => void;
  onAdd: (title: string) => void;
}) {
  const byStatus = (s: TodoStatus) => todos.filter((t) => t.status === s);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {STATUSES.map((status) => {
        const cols = byStatus(status);
        return (
          <div key={status} className={cn('rounded-xl border border-slate-200 overflow-hidden', STATUS_COLUMN_BG[status])}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/80">
              <span className="text-sm font-semibold text-slate-700">{STATUS_LABEL[status]}</span>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold text-slate-500">{cols.length}</span>
            </div>
            <div className="p-3 space-y-2 min-h-24">
              {cols.map((todo) => (
                <KanbanCard
                  key={todo.id}
                  todo={todo}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                />
              ))}
            </div>
            {status === 'new' && (
              <div className="border-t border-slate-200/80">
                <AddTaskRow onAdd={onAdd} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ViewMode = 'table' | 'kanban';

export default function TasksPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('table');

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // Sync auto-todos from due review chapters
      const dueChapters = await fetchDueReviewChaptersForUser(user.id);
      const fresh = dueChapters.length > 0
        ? await syncAutoTodos(user.id, dueChapters)
        : await fetchTodos(user.id);
      setTodos(fresh);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = useCallback(async (id: string, status: TodoStatus) => {
    setTodos((prev) => prev.map((t) => t.id === id ? { ...t, status } : t));
    await updateTodo(id, { status });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    await deleteTodo(id);
  }, []);

  const handleAdd = useCallback(async (title: string) => {
    if (!user?.id) return;
    const created = await createTodo(user.id, { title });
    if (created) setTodos((prev) => [created, ...prev]);
  }, [user?.id]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('tasks.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('tasks.description')}</p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 self-start sm:self-auto">
          <button
            onClick={() => setView('table')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'table' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutList className="h-3.5 w-3.5" />
            {t('tasks.tableView')}
          </button>
          <button
            onClick={() => setView('kanban')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'kanban' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Kanban className="h-3.5 w-3.5" />
            {t('tasks.kanbanView')}
          </button>
        </div>
      </header>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{t('tasks.loading')}</span>
        </div>
      ) : view === 'table' ? (
        <TableView
          todos={todos}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onAdd={handleAdd}
        />
      ) : (
        <KanbanView
          todos={todos}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}
