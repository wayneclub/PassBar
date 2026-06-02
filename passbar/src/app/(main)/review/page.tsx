"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Calendar, Clock, CheckCircle2, ArrowRight, Search, SlidersHorizontal, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getQuestionsByIds } from '@/lib/question-bank';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Question } from '@/lib/types';

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
  raw: {
    subjects?: string[];
    chapters?: string[];
    questionIds?: string[];
    userAnswers?: Record<string, string>;
    createdAt?: number;
  } | null;
};

type PracticeAnswerRow = {
  session_id: string;
  question_id: string;
  selected_choice: string | null;
  is_correct: boolean | null;
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

function getSessionDuration(session: PracticeSessionRow) {
  if (session.total_time_seconds && session.total_time_seconds > 0) return session.total_time_seconds;
  if (!session.started_at || !session.completed_at) return 0;
  return Math.max(0, Math.round((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000));
}

function getAnswerChoiceKey(question: Question, answer: string) {
  const candidates = [question.options, question.bilingualOptions ?? []];
  for (const options of candidates) {
    const index = options.findIndex((o) => o === answer);
    if (index !== -1) return String.fromCharCode(65 + index);
  }
  return answer.match(/^\s*([A-D])\./i)?.[1]?.toUpperCase() ?? null;
}

const MODES = ['Tutor', 'Timed', 'Browse'] as const;

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
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [search, setSearch] = useState('');
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user?.id || !supabase) { setSessions([]); setIsLoading(false); return; }
      setIsLoading(true);

      const { data: sessionRows, error: sessionError } = await supabase
        .from('practice_sessions')
        .select('id, mode, status, subject_ids, chapter_ids, question_count, started_at, completed_at, total_time_seconds, raw')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false });

      if (sessionError) { console.warn('Unable to load practice history:', sessionError.message); setSessions([]); setIsLoading(false); return; }

      const rows = (sessionRows ?? []) as PracticeSessionRow[];
      const ids = rows.map((r) => r.id);
      const answerRows = ids.length > 0
        ? await supabase.from('practice_answers').select('session_id, question_id, selected_choice, is_correct').in('session_id', ids)
        : { data: [] as PracticeAnswerRow[], error: null };

      const answersBySession = new Map<string, PracticeAnswerRow[]>();
      ((answerRows.data ?? []) as PracticeAnswerRow[]).forEach((a) => {
        (answersBySession.get(a.session_id) ?? answersBySession.set(a.session_id, []).get(a.session_id)!).push(a);
      });

      const rawQIds = Array.from(new Set(rows.flatMap((r) => Object.keys(r.raw?.userAnswers ?? {}))));
      const rawQRows = rawQIds.length > 0 ? await getQuestionsByIds(rawQIds) : [];
      const rawQById = new Map(rawQRows.map((q) => [q.id, q]));

      const next = rows.map((row) => {
        const answers = answersBySession.get(row.id) ?? [];
        const rawAnswers = row.raw?.userAnswers ?? {};
        const rawEntries = Object.entries(rawAnswers);
        const answered = answers.length > 0 ? answers.length : rawEntries.length;
        const correct = answers.length > 0
          ? answers.filter((a) => a.is_correct).length
          : rawEntries.filter(([qId, ans]) => {
            const q = rawQById.get(qId);
            const sel = q ? getAnswerChoiceKey(q, ans) : null;
            const ok = (q?.apiAnswerKey ?? q?.correctAnswerLetter)?.toUpperCase() ?? null;
            return Boolean(sel && ok && sel === ok);
          }).length;
        const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
        const subjects = row.raw?.subjects?.length ? row.raw.subjects : (row.subject_ids ?? []);
        const chapters = row.raw?.chapters?.length ? row.raw.chapters : (row.chapter_ids ?? []);
        const createdAt = row.raw?.createdAt ? new Date(row.raw.createdAt) : new Date(row.started_at ?? Date.now());

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

      // Hide in_progress sessions with 0 answers (abandoned without answering anything)
      setSessions(next.filter((s) => s.status !== 'in_progress' || s.answered > 0));
      setIsLoading(false);
    };
    loadHistory();
  }, [t, user?.id]);

  const allSubjects = useMemo(() => Array.from(new Set(sessions.flatMap((s) => s.subjects))).sort(), [sessions]);

  // Map chapter slug → display name (subject prefix stripped)
  const chapterNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      for (const ch of s.chapters) {
        if (!map.has(ch)) map.set(ch, chapterDisplayName(ch, s.subjects));
      }
    }
    return map;
  }, [sessions]);

  const allChapters = useMemo(() => {
    const filtered = selectedSubjects.size > 0
      ? sessions.filter((s) => s.subjects.some((sub) => selectedSubjects.has(sub)))
      : sessions;
    return Array.from(new Set(filtered.flatMap((s) => s.chapters))).sort();
  }, [sessions, selectedSubjects]);

  const modeLabel = (mode: string) => {
    if (mode === 'Tutor') return t('create.tutor');
    if (mode === 'Timed') return t('create.timed');
    if (mode === 'Browse') return t('create.browse');
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

  const activeFilterCount = selectedModes.size + selectedSubjects.size + selectedChapters.size;

  const clearFilters = () => { setSelectedModes(new Set()); setSelectedSubjects(new Set()); setSelectedChapters(new Set()); };

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    setFn(next);
  };

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : language, {
    month: 'short', day: 'numeric', year: 'numeric',
  }), [language]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-4xl font-bold text-primary">{t('review.title')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 pl-10 w-64 text-sm"
              placeholder={t('review.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="h-10 gap-2 px-4 relative">
                <SlidersHorizontal className="w-4 h-4" />
                {t('review.filterMode')}
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 overflow-y-auto">
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center justify-between">
                  <span>{t('review.filterMode')}</span>
                  {activeFilterCount > 0 && (
                    <button type="button" onClick={clearFilters} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <X className="h-3 w-3" /> {t('review.filterAll')}
                    </button>
                  )}
                </SheetTitle>
              </SheetHeader>

              {/* Mode */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('create.testMode')}</p>
                <div className="flex flex-wrap gap-2">
                  {MODES.map((m) => (
                    <FilterChip key={m} label={modeLabel(m)} active={selectedModes.has(m)} onClick={() => toggle(selectedModes, setSelectedModes, m)} />
                  ))}
                </div>
              </div>

              <Separator className="my-4" />

              {/* Subjects */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('create.subjectsAndChapters')}</p>
                <div className="flex flex-wrap gap-2">
                  {allSubjects.map((sub) => (
                    <FilterChip key={sub} label={sub} active={selectedSubjects.has(sub)} onClick={() => toggle(selectedSubjects, setSelectedSubjects, sub)} />
                  ))}
                </div>
              </div>

              {/* Chapters (only if subjects selected or chapters exist) */}
              {allChapters.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('create.selectedChapters')}</p>
                    <div className="flex flex-wrap gap-2">
                      {allChapters.map((ch) => (
                        <FilterChip key={ch} label={chapterNameMap.get(ch) ?? ch} active={selectedChapters.has(ch)} onClick={() => toggle(selectedChapters, setSelectedChapters, ch)} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>

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
                <div className="flex flex-col md:flex-row items-center">
                  <div className="p-6 md:w-40 border-b md:border-b-0 md:border-r flex flex-col items-center justify-center bg-primary/5 shrink-0">
                    <div className="text-3xl font-black text-primary">{session.percent}%</div>
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-1">{t('review.accuracy')}</div>
                  </div>

                  <div className="p-6 flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="border-secondary text-secondary font-bold text-xs">
                          {modeLabel(session.mode)}
                        </Badge>
                        {session.status === 'suspended' && (
                          <Badge variant="outline" className="border-amber-400 text-amber-600 font-bold text-xs">
                            {t('review.suspended')}
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground">{dateFormatter.format(session.createdAt)}</span>
                      </div>
                      <h3 className="font-bold text-base truncate">{session.subjectLabel}</h3>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> {t('review.duration')}
                        </span>
                        <span className="text-base font-semibold">{formatDuration(session.durationSeconds)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> {t('review.correct')}
                        </span>
                        <span className="text-base font-semibold">{session.correct} / {session.answered}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end">
                      <Button variant="ghost" className="group-hover:text-primary gap-2" asChild>
                        <Link href={`/test?id=${encodeURIComponent(session.id)}&review=1`}>
                          {t('review.reviewQuestions')}
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
