"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Check, ChevronLeft, ChevronRight, Loader2, Save, Search,
  Flag, CheckCircle2, Clock, MessageSquare, User, Filter,
} from 'lucide-react';
import { getAdminDb } from '@/lib/admin-client';
import { resolveQuestionReport, type QuestionReport, type ReportCategory } from '@/lib/question-reports';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Suspense } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type QuestionRow = {
  id: string;
  subject: string;
  chapter_name: string;
  question_text: string;
  micro_concept: string | null;
  trap_type: string | null;
  skill_tested: string | null;
};

type EditState = {
  micro_concept: string;
  trap_type: string;
  skill_tested: string;
};

type ReportWithQuestion = QuestionReport & {
  questions?: { question_text: string; subject: string; chapter_name: string } | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  wrong_answer:          '答案有誤',
  typo:                  '題目誤字',
  unclear:               '說明不清',
  outdated:              '內容過時',
  explanation_incorrect: '解析有誤',
  other:                 '其他',
};

const CATEGORY_COLORS: Record<ReportCategory, string> = {
  wrong_answer:          'bg-red-100 text-red-700 border-red-200',
  typo:                  'bg-orange-100 text-orange-700 border-orange-200',
  unclear:               'bg-amber-100 text-amber-700 border-amber-200',
  outdated:              'bg-blue-100 text-blue-700 border-blue-200',
  explanation_incorrect: 'bg-purple-100 text-purple-700 border-purple-200',
  other:                 'bg-slate-100 text-slate-600 border-slate-200',
};

function reportCategories(report: QuestionReport): ReportCategory[] {
  return report.categories && report.categories.length > 0 ? report.categories : [report.category];
}

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

// ─── Reports Tab ─────────────────────────────────────────────────────────────

function ReportsTab() {
  const db = getAdminDb();
  const [reports, setReports] = useState<ReportWithQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [filterResolved, setFilterResolved] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');

  const loadReports = useCallback(async () => {
    if (!db) return;
    setLoading(true);

    // Fetch reports + reporter profiles (profiles FK exists)
    let q = db
      .from('question_reports')
      .select('*, profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filterResolved === 'unresolved') q = q.eq('resolved', false);
    else if (filterResolved === 'resolved') q = q.eq('resolved', true);

    const { data, error } = await q;
    if (error) { setLoading(false); return; }

    const reports = (data ?? []) as QuestionReport[];

    // Fetch question snippets separately to avoid FK join issues
    const questionIds = [...new Set(reports.map((r) => r.question_id))];
    let questionsMap: Record<string, { question_text: string; subject: string; chapter_name: string }> = {};

    if (questionIds.length > 0) {
      const { data: qData } = await db
        .from('questions')
        .select('id, question_text, subject, chapter_name')
        .in('id', questionIds);

      for (const q of (qData ?? []) as { id: string; question_text: string; subject: string; chapter_name: string }[]) {
        questionsMap[q.id] = { question_text: q.question_text, subject: q.subject, chapter_name: q.chapter_name };
      }
    }

    setReports(reports.map((r) => ({ ...r, questions: questionsMap[r.question_id] ?? null })));
    setLoading(false);
  }, [db, filterResolved]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const handleResolve = async (reportId: string) => {
    setResolving((prev) => ({ ...prev, [reportId]: true }));
    const ok = await resolveQuestionReport(reportId);
    if (ok) {
      setReports((prev) => prev.map((r) =>
        r.id === reportId ? { ...r, resolved: true, resolved_at: new Date().toISOString() } : r
      ));
    }
    setResolving((prev) => ({ ...prev, [reportId]: false }));
  };

  const unresolvedCount = reports.filter((r) => !r.resolved).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">使用者反饋</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            查看並處理使用者回報的題目問題
          </p>
        </div>
        {unresolvedCount > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
            {unresolvedCount} 件待處理
          </span>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {(['unresolved', 'all', 'resolved'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setFilterResolved(v)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filterResolved === v
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50',
            )}
          >
            {{ unresolved: '未處理', all: '全部', resolved: '已處理' }[v]}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> 載入中…
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-400" />
          <p className="text-sm text-muted-foreground">目前沒有待處理的反饋</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className={cn(
                'rounded-xl border bg-white p-5 transition-colors',
                report.resolved ? 'border-slate-100 opacity-60' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Category + time */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {reportCategories(report).map((cat) => (
                      <Badge key={cat} className={cn('text-xs border font-medium', CATEGORY_COLORS[cat])}>
                        <Flag className="h-3 w-3 mr-1" />
                        {CATEGORY_LABELS[cat]}
                      </Badge>
                    ))}
                    {report.language && (
                      <Badge className="text-xs border bg-slate-100 text-slate-600 border-slate-200">
                        {report.language}
                      </Badge>
                    )}
                    {report.resolved && (
                      <Badge className="text-xs border bg-green-100 text-green-700 border-green-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        已處理
                      </Badge>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {timeAgo(report.created_at)}
                    </span>
                  </div>

                  {/* Question snippet */}
                  {report.questions && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 border border-slate-100">
                      <span className="font-medium text-primary mr-1.5">{report.questions.subject}</span>
                      <span className="text-slate-400 mr-1.5">·</span>
                      <span className="text-slate-500 mr-2">{report.questions.chapter_name}</span>
                      <span className="line-clamp-2 text-slate-700 mt-0.5">{report.questions.question_text}</span>
                    </div>
                  )}

                  {/* User message */}
                  {report.message && (
                    <div className="flex items-start gap-2 text-sm text-slate-700">
                      <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <p className="leading-snug">{report.message}</p>
                    </div>
                  )}

                  {/* Reporter */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {(report.profiles as { full_name: string | null; email: string | null } | null)?.full_name
                      ?? (report.profiles as { full_name: string | null; email: string | null } | null)?.email
                      ?? '匿名使用者'}
                    <span className="text-slate-300 mx-1">·</span>
                    <span className="font-mono text-[10px] text-slate-400">{report.question_id}</span>
                  </div>
                </div>

                {/* Action */}
                {!report.resolved && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-8 text-xs border-green-300 text-green-700 hover:bg-green-50"
                    disabled={resolving[report.id]}
                    onClick={() => handleResolve(report.id)}
                  >
                    {resolving[report.id]
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <><Check className="h-3 w-3 mr-1" />標為已處理</>
                    }
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Questions Tab ────────────────────────────────────────────────────────────

function QuestionsTab() {
  const db = getAdminDb();
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [subjects, setSubjects] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!db) return;
    db.from('subjects').select('subject').then(({ data }) => {
      if (data) setSubjects(data.map((r: { subject: string }) => r.subject).sort());
    });
  }, [db]);

  const load = useCallback(async (pageNum: number) => {
    if (!db) return;
    setLoading(true);
    let q = db
      .from('questions')
      .select('id, subject, chapter_name, question_text, micro_concept, trap_type, skill_tested', { count: 'exact' });
    if (subjectFilter) q = q.eq('subject', subjectFilter);
    if (search.trim()) q = q.ilike('question_text', `%${search.trim()}%`);
    if (onlyEmpty) q = q.or('micro_concept.is.null,trap_type.is.null,skill_tested.is.null');
    q = q.order('id').range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);
    const { data, count } = await q;
    setRows((data as QuestionRow[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [db, subjectFilter, search, onlyEmpty]);

  useEffect(() => {
    setPage(0);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(0), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [load]);

  useEffect(() => { load(page); }, [page, load]);

  function getEdit(row: QuestionRow): EditState {
    return edits[row.id] ?? {
      micro_concept: row.micro_concept ?? '',
      trap_type: row.trap_type ?? '',
      skill_tested: row.skill_tested ?? '',
    };
  }

  function setField(id: string, field: keyof EditState, value: string) {
    setEdits((prev) => ({ ...prev, [id]: { ...getEdit({ id } as QuestionRow), ...prev[id], [field]: value } }));
    setSaved((prev) => ({ ...prev, [id]: false }));
  }

  async function saveRow(row: QuestionRow) {
    if (!db) return;
    const edit = getEdit(row);
    setSaving((prev) => ({ ...prev, [row.id]: true }));
    const { error } = await db
      .from('question_items')
      .update({
        micro_concept: edit.micro_concept.trim() || null,
        trap_type:     edit.trap_type.trim()     || null,
        skill_tested:  edit.skill_tested.trim()  || null,
      })
      .eq('id', row.id);
    setSaving((prev) => ({ ...prev, [row.id]: false }));
    if (!error) {
      setSaved((prev) => ({ ...prev, [row.id]: true }));
      setRows((prev) => prev.map((r) =>
        r.id === row.id
          ? { ...r, micro_concept: edit.micro_concept || null, trap_type: edit.trap_type || null, skill_tested: edit.skill_tested || null }
          : r,
      ));
      setEdits((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">題目元資料管理</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          為每道題目填入 Micro Concept、Trap Type、Skill Tested，供學習表現頁使用。
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋題目內容..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">全部科目</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="rounded" />
          只顯示未填寫
        </label>
        <span className="text-sm text-muted-foreground ml-auto">共 {total} 題</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> 載入中…
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-24">科目</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-36">Topic</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">題目（摘要）</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-44">Micro Concept</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-44">Trap Type</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-44">Skill Tested</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground">沒有符合條件的題目</td>
                </tr>
              ) : rows.map((row) => {
                const edit = getEdit(row);
                const isDirty = edits[row.id] !== undefined;
                const isSaving = saving[row.id];
                const isSaved = saved[row.id];
                return (
                  <tr key={row.id} className={cn('hover:bg-slate-50/60 transition-colors', isDirty && 'bg-amber-50/40')}>
                    <td className="px-4 py-3 text-xs font-medium text-primary align-top pt-4">{row.subject}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 align-top pt-4 leading-snug">{row.chapter_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-700 align-top pt-4 max-w-xs">
                      <p className="line-clamp-3 leading-snug">{row.question_text}</p>
                      <p className="text-muted-foreground mt-0.5 font-mono">{row.id}</p>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <Input placeholder="e.g. Offer & Acceptance" value={edit.micro_concept} onChange={(e) => setField(row.id, 'micro_concept', e.target.value)} className="h-8 text-xs" />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <Input placeholder="e.g. Distractor Trap" value={edit.trap_type} onChange={(e) => setField(row.id, 'trap_type', e.target.value)} className="h-8 text-xs" />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <Input placeholder="e.g. Apply UCC §2-207" value={edit.skill_tested} onChange={(e) => setField(row.id, 'skill_tested', e.target.value)} className="h-8 text-xs" />
                    </td>
                    <td className="px-4 py-2 align-top">
                      {isSaved ? (
                        <Check className="h-4 w-4 text-green-600 mx-auto mt-1" />
                      ) : (
                        <Button size="sm" variant={isDirty ? 'default' : 'ghost'} className="h-8 px-2" disabled={!isDirty || isSaving} onClick={() => saveRow(row)}>
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 頁</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function AdminQuestionsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') === 'reports' ? 'reports' : 'questions';

  const setTab = (t: string) => {
    router.push(`/admin/questions?tab=${t}`);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">題庫管理</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('questions')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'questions'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          題目元資料
        </button>
        <button
          onClick={() => setTab('reports')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
            tab === 'reports'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          <Flag className="h-3.5 w-3.5" />
          使用者反饋
        </button>
      </div>

      {tab === 'reports' ? <ReportsTab /> : <QuestionsTab />}
    </div>
  );
}

export default function AdminQuestionsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <AdminQuestionsContent />
    </Suspense>
  );
}
