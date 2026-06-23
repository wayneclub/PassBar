"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Calendar, Clock, CheckCircle2, ArrowRight, Search, SlidersHorizontal, X, ChevronDown, Trash2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { deletePracticeSessionRecord } from '@/lib/practice-sessions';
import { deletePendingAnswerSyncItemsForSession, deleteTestQuestionSnapshot } from '@/lib/offline-cache';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type PracticeSessionRow = {
  id: string;
  mode: string | null;
  status: string | null;
  subject_ids: string[] | null;
  chapter_ids: string[] | null;
  question_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  total_time_seconds: number | null;
  answered_count: number | null;
  correct_count: number | null;
};

type ReviewSession = {
  id: string;
  mode: string;
  status: string;
  subjectLabel: string;
  subjects: string[];
  chapters: string[];
  searchableText: string;
  createdAt: Date;
  durationSeconds: number;
  correct: number;
  answered: number;
  percent: number;
};

function formatDuration(seconds: number) {
  if (!seconds || seconds < 0) return '0s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function dateRangeLabel(range: 'all' | '7d' | '30d', t: ReturnType<typeof useI18n>['t']) {
  if (range === 'all') return t('review.rangeAll');
  if (range === '7d') return t('review.range7d');
  return t('review.range30d');
}

function getSessionDuration(session: PracticeSessionRow) {
  if (session.total_time_seconds && session.total_time_seconds > 0) return session.total_time_seconds;
  if (!session.started_at || !session.completed_at) return 0;
  return Math.max(0, Math.round((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000));
}

const MODES = ['Tutor', 'Timed', 'SimExam'] as const;

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function chapterDisplayName(chapterId: string, subjectNames: string[]): string {
  for (const subject of subjectNames) {
    const prefix = toSlug(subject) + '-';
    if (chapterId.startsWith(prefix)) {
      const rest = chapterId.slice(prefix.length);
      return rest.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }
  return chapterId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50 hover:bg-primary/5',
      )}
    >
      {label}
    </button>
  );
}

export default function ReviewHistoryPage() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const PAGE_SIZE = 15;

  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d'>('all');
  const [search, setSearch] = useState('');
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  // allSubjects/allChapters are populated from a separate lightweight fetch so filter chips
  // remain correct regardless of the current page.
  const [allSubjectsGlobal, setAllSubjectsGlobal] = useState<string[]>([]);
  const [allChaptersGlobal, setAllChaptersGlobal] = useState<string[]>([]);
  const [chapterNameMapGlobal, setChapterNameMapGlobal] = useState<Map<string, string>>(new Map());
  const [filterOpen, setFilterOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Lightweight fetch to populate filter options (subject/chapter lists) once on mount.
  useEffect(() => {
    if (!filterOpen || allSubjectsGlobal.length > 0 || allChaptersGlobal.length > 0) return;
    if (!user?.id) return;
    api
      .get<Array<{ subjectIds: string[]; chapterIds: string[] }>>('/attempts/dashboard/review-filter-options')
      .then((rows) => {
        const subjectSet = new Set<string>();
        const chapterSet = new Set<string>();
        const nameMap = new Map<string, string>();
        rows.forEach((r) => {
          const subjects = r.subjectIds ?? [];
          const chapters = r.chapterIds ?? [];
          subjects.forEach((s) => subjectSet.add(s));
          chapters.forEach((ch) => {
            chapterSet.add(ch);
            if (!nameMap.has(ch)) nameMap.set(ch, chapterDisplayName(ch, subjects));
          });
        });
        setAllSubjectsGlobal([...subjectSet].sort());
        setAllChaptersGlobal([...chapterSet].sort());
        setChapterNameMapGlobal(nameMap);
      })
      .catch((err) => console.warn('Unable to load filter options:', err));
  }, [allChaptersGlobal.length, allSubjectsGlobal.length, filterOpen, user?.id, historyVersion]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user?.id) { setSessions([]); setTotalCount(0); setIsLoading(false); return; }
      setIsLoading(true);

      let since: string | undefined;
      if (dateRange !== 'all') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - (dateRange === '7d' ? 7 : 30));
        since = cutoff.toISOString();
      }

      let result: { rows: Array<{
        id: string; mode: string | null; status: string | null; subjectIds: string[] | null; chapterIds: string[] | null;
        questionCount: number | null; startedAt: string | null; completedAt: string | null; totalTimeSeconds: number | null;
        answeredCount: number | null; correctCount: number | null;
      }>; totalCount: number };
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(PAGE_SIZE));
        if (since) params.set('since', since);
        result = await api.get(`/attempts/dashboard/review-sessions?${params.toString()}`);
      } catch (err) {
        console.warn('Unable to load practice history:', err);
        setSessions([]);
        setIsLoading(false);
        return;
      }

      setTotalCount(result.totalCount);
      const rows: PracticeSessionRow[] = result.rows.map((r) => ({
        id: r.id,
        mode: r.mode,
        status: r.status,
        subject_ids: r.subjectIds,
        chapter_ids: r.chapterIds,
        question_count: r.questionCount,
        started_at: r.startedAt,
        completed_at: r.completedAt,
        total_time_seconds: r.totalTimeSeconds,
        answered_count: r.answeredCount,
        correct_count: r.correctCount,
      }));

      const next = rows.map((row) => {
        const answered = row.answered_count ?? 0;
        const correct = row.correct_count ?? 0;
        const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
        const subjects = row.subject_ids ?? [];
        const chapters = row.chapter_ids ?? [];
        const createdAt = new Date(row.started_at ?? Date.now());

        return {
          id: row.id,
          mode: row.mode ?? 'Tutor',
          status: row.status ?? 'completed',
          subjectLabel: subjects.length > 0 ? subjects.join(', ') : t('review.mixedSubjects'),
          subjects,
          chapters,
          searchableText: [...subjects, ...chapters, row.mode ?? '', row.status ?? ''].join(' ').toLowerCase(),
          createdAt,
          durationSeconds: getSessionDuration(row),
          correct,
          answered,
          percent,
        };
      });

      setSessions(next.filter((s) => s.status !== 'in_progress' || s.answered > 0));
      setIsLoading(false);
    };
    loadHistory();
  }, [t, user?.id, page, dateRange, historyVersion]);

  // Reset to page 0 when date range changes
  const handleDateRange = (v: 'all' | '7d' | '30d') => { setDateRange(v); setPage(0); };

  const allSubjects = allSubjectsGlobal;

  const chapterNameMap = chapterNameMapGlobal;

  const allChapters = useMemo(() => {
    if (selectedSubjects.size === 0) return allChaptersGlobal;
    return allChaptersGlobal.filter((ch) => {
      const name = chapterNameMapGlobal.get(ch) ?? ch;
      return [...selectedSubjects].some((sub) => ch.startsWith(sub.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
    });
  }, [allChaptersGlobal, selectedSubjects, chapterNameMapGlobal]);

  const modeLabel = (mode: string) => {
    if (mode === 'Tutor') return t('create.tutor');
    if (mode === 'Timed') return t('create.timed');
    if (mode === 'SimExam') return t('nav.simExam');
    return mode;
  };

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (selectedModes.size > 0) result = result.filter((s) => selectedModes.has(s.mode));
    if (selectedSubjects.size > 0) result = result.filter((s) => s.subjects.some((sub) => selectedSubjects.has(sub)));
    if (selectedChapters.size > 0) result = result.filter((s) => s.chapters.some((ch) => selectedChapters.has(ch)));
    const term = search.trim().toLowerCase();
    if (term) result = result.filter((s) => s.searchableText.includes(term) || s.subjectLabel.toLowerCase().includes(term));
    return result;
  }, [sessions, search, selectedModes, selectedSubjects, selectedChapters]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const activeFilterCount = selectedModes.size + selectedSubjects.size + selectedChapters.size;

  const clearFilters = () => { setSelectedModes(new Set()); setSelectedSubjects(new Set()); setSelectedChapters(new Set()); };

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    setFn(next);
  };

  const removeLocalSession = (sessionId: string) => {
    (['passbar_sessions', 'uprep_sessions'] as const).forEach((key) => {
      const sessions = JSON.parse(localStorage.getItem(key) || '[]') as Array<{ id?: string }>;
      const next = sessions.filter((session) => session.id !== sessionId);
      if (next.length !== sessions.length) localStorage.setItem(key, JSON.stringify(next));
    });
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!user?.id || deletingSessionId) return;
    setDeletingSessionId(sessionId);
    try {
      const ok = await deletePracticeSessionRecord({ sessionId, userId: user.id });
      if (!ok) return;
      removeLocalSession(sessionId);
      await deleteTestQuestionSnapshot(sessionId);
      await deletePendingAnswerSyncItemsForSession(sessionId);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setTotalCount((count) => Math.max(0, count - 1));
      if (sessions.length === 1 && page > 0) setPage((current) => Math.max(0, current - 1));
      setHistoryVersion((version) => version + 1);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : language, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }), [language]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-primary">{t('review.title')}</h1>
          {/* Date range pills */}
          <div className="flex gap-1.5">
            {(['all', '7d', '30d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => handleDateRange(r)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  dateRange === r
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-primary/50 hover:bg-primary/5',
                )}
              >
                {dateRangeLabel(r, t)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:flex-initial">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 pl-10 w-full md:w-64 text-sm"
              placeholder={t('review.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Button
            variant="outline"
            className="h-10 gap-2 px-3 sm:px-4 relative shrink-0"
            onClick={() => setFilterOpen((v) => !v)}
          >
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            {t('review.filterMode')}
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown className={cn('w-3 h-3 ml-0.5 transition-transform duration-200', filterOpen && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {/* Inline filter panel */}
      {filterOpen && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('review.filterMode')}</p>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <X className="h-3 w-3" /> {t('review.filterAll')}
              </button>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{t('create.testMode')}</p>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <FilterChip key={m} label={modeLabel(m)} active={selectedModes.has(m)} onClick={() => toggle(selectedModes, setSelectedModes, m)} />
              ))}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{t('create.subjectsAndChapters')}</p>
            <div className="flex flex-wrap gap-2">
              {allSubjects.map((sub) => (
                <FilterChip key={sub} label={sub} active={selectedSubjects.has(sub)} onClick={() => toggle(selectedSubjects, setSelectedSubjects, sub)} />
              ))}
            </div>
          </div>

          {allChapters.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{t('create.selectedChapters')}</p>
                <div className="flex flex-wrap gap-2">
                  {allChapters.map((ch) => (
                    <FilterChip key={ch} label={chapterNameMap.get(ch) ?? ch} active={selectedChapters.has(ch)} onClick={() => toggle(selectedChapters, setSelectedChapters, ch)} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from(selectedModes).map((m) => (
            <Badge key={m} variant="secondary" className="gap-1 pr-1">
              {modeLabel(m)}
              <button type="button" onClick={() => toggle(selectedModes, setSelectedModes, m)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
          {Array.from(selectedSubjects).map((s) => (
            <Badge key={s} variant="secondary" className="gap-1 pr-1">
              {s}
              <button type="button" onClick={() => toggle(selectedSubjects, setSelectedSubjects, s)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
          {Array.from(selectedChapters).map((c) => (
            <Badge key={c} variant="secondary" className="gap-1 pr-1">
              {chapterNameMap.get(c) ?? c}
              <button type="button" onClick={() => toggle(selectedChapters, setSelectedChapters, c)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
          <button type="button" onClick={clearFilters} className="text-xs text-slate-400 hover:text-primary">
            {t('review.filterAll')}
          </button>
        </div>
      )}

      {/* Sessions */}
      {isLoading ? (
        <Card className="p-12 text-center bg-white/50">
          <p className="text-muted-foreground">{t('review.loading')}</p>
        </Card>
      ) : filteredSessions.length === 0 ? (
        <Card className="p-12 text-center bg-white/50 border-dashed">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-muted rounded-full">
              <Calendar className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-xl font-bold">{t('review.noSessions')}</h3>
              <p className="text-muted-foreground mt-1 max-w-sm mx-auto">{t('review.noSessionsDescription')}</p>
            </div>
            <Button asChild className="mt-2">
              <Link href="/create">{t('review.createFirstTest')}</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredSessions.map((session) => (
            <Card key={session.id} className="overflow-hidden hover:shadow-md transition-shadow group border-l-4 border-l-primary">
              <CardContent className="p-0">
                <div className="flex flex-row items-stretch">
                  <div className="p-3 md:p-6 w-20 md:w-40 border-r flex flex-col items-center justify-center bg-primary/5 shrink-0">
                    <div className="text-xl md:text-3xl font-black text-primary">{session.percent}%</div>
                    <div className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-muted-foreground mt-0.5 md:mt-1">{t('review.accuracy')}</div>
                  </div>

                  <div className="p-4 md:px-6 md:py-5 flex-1 flex flex-col gap-3 min-w-0">
                    {/* Row 1: subjects + chapters */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {session.subjects.length > 0
                          ? session.subjects.map((sub) => (
                              <span key={sub} className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
                                {sub}
                              </span>
                            ))
                          : <span className="text-base font-bold text-slate-700">{session.subjectLabel}</span>
                        }
                      </div>
                      {session.chapters.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {session.chapters.map((ch) => (
                            <span key={ch} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500">
                              {chapterNameMap.get(ch) ?? ch}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Row 2: metadata + stats + action */}
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="border-secondary text-secondary font-bold text-xs">
                          {modeLabel(session.mode)}
                        </Badge>
                        {session.status === 'in_progress' && (
                          <Badge variant="outline" className="border-blue-400 text-blue-600 font-bold text-xs">
                            {t('review.draft')}
                          </Badge>
                        )}
                        {session.status === 'suspended' && (
                          <Badge variant="outline" className="border-amber-400 text-amber-600 font-bold text-xs">
                            {t('review.suspended')}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{dateFormatter.format(session.createdAt)}</span>
                        <span className="text-slate-300 select-none">·</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="font-semibold text-slate-700">{formatDuration(session.durationSeconds)}</span>
                        </span>
                        <span className="text-slate-300 select-none">·</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                          <span className="font-semibold text-slate-700">{session.correct} / {session.answered}</span>
                          <span>{t('review.correct')}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              aria-label={t('review.deleteSession')}
                              disabled={deletingSessionId === session.id}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('review.deleteSessionTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('review.deleteSessionDescription')}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={deletingSessionId === session.id}>
                                {t('review.cancelDelete')}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-600 text-white hover:bg-red-700"
                                disabled={deletingSessionId === session.id}
                                onClick={(event) => {
                                  event.preventDefault();
                                  void handleDeleteSession(session.id);
                                }}
                              >
                                {deletingSessionId === session.id ? t('review.deletingSession') : t('review.confirmDelete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        {session.status === 'in_progress' ? (
                          <Button variant="ghost" className="group-hover:text-primary gap-1.5 shrink-0 h-8 px-3 text-sm" asChild>
                            <Link href={`/test?id=${encodeURIComponent(session.id)}`}>
                              {t('review.continueDraft')}
                              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </Link>
                          </Button>
                        ) : (
                          <Button variant="ghost" className="group-hover:text-primary gap-1.5 shrink-0 h-8 px-3 text-sm" asChild>
                            <Link href={`/test?id=${encodeURIComponent(session.id)}&review=1`}>
                              {t('review.reviewQuestions')}
                              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            {t('review.paginationSummary', { page: page + 1, totalPages, totalCount })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || isLoading}
              onClick={() => setPage(0)}
              className="h-8 px-2 text-xs"
            >
              «
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || isLoading}
              onClick={() => setPage((p) => p - 1)}
              className="h-8 px-3 text-xs"
            >
              {t('review.previousPage')}
            </Button>
            {/* Page number pills */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const half = 2;
              let start = Math.max(0, page - half);
              const end = Math.min(totalPages - 1, start + 4);
              start = Math.max(0, end - 4);
              return start + i;
            }).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                disabled={isLoading}
                className={cn(
                  'h-8 w-8 rounded-md text-xs font-medium border transition-colors',
                  p === page
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-primary/50',
                )}
              >
                {p + 1}
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1 || isLoading}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 px-3 text-xs"
            >
              {t('review.nextPage')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1 || isLoading}
              onClick={() => setPage(totalPages - 1)}
              className="h-8 px-2 text-xs"
            >
              »
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
