"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, BookOpen, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, Coffee, LayoutGrid, Loader2, PartyPopper, Rocket, RotateCcw, Search, LineChart, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/components/AuthProvider';
import { getMbeChineseLabel } from '@/lib/mbe-labels';
import { getFocusSubjectForDate, type ChapterReviewInfo } from '@/lib/smart-planner';
import type { StudySubjectMode } from '@/lib/study-settings';
import type { Subject } from '@/lib/types';

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toKey(date: Date) {
  return startOfLocalDay(date).toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** ISO-8601 week number (1–53) for a given date. */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
};

const DAY_KEYS = ['plan.day.sun', 'plan.day.mon', 'plan.day.tue', 'plan.day.wed', 'plan.day.thu', 'plan.day.fri', 'plan.day.sat'] as const;

const SUBJECT_BADGE_COLORS = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-emerald-100 text-emerald-700 border-emerald-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-violet-100 text-violet-700 border-violet-200',
  'bg-rose-100 text-rose-700 border-rose-200',
  'bg-cyan-100 text-cyan-700 border-cyan-200',
  'bg-orange-100 text-orange-700 border-orange-200',
  'bg-lime-100 text-lime-700 border-lime-200',
];

type DayCell = {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
};

type PlannedTask = {
  kind: 'new' | 'review';
  subject: string;
  chapterId: string;
  chapter: string;
  target: number;
  accuracy?: number;
  days?: number;
  averageSeconds?: number;
  masteryRate?: number;
};

function getWeekDays(referenceDate: Date): Date[] {
  const start = new Date(referenceDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function buildMonthGrid(year: number, month: number): DayCell[][] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const lastOfMonth = new Date(year, month + 1, 0);
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const weeks: DayCell[][] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        date: new Date(cursor),
        key: toKey(cursor),
        inCurrentMonth: cursor.getMonth() === month,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

type Props = {
  examDate: string | null;
  studyDays: number[];
  dailyQuota: number;
  dailyNewQuota: number;
  dailyReviewQuota: number;
  remainingQuestions: number;
  triageWeeks: number;
  subjectMode: StudySubjectMode;
  subjectQuotas: Record<string, number>;
  subjects: Subject[];
  subjectsWithRemaining: { name: string; remaining: number }[];
  subjectConfidence: Record<string, number>;
  dueReviewChapters: ChapterReviewInfo[];
  dailyChapterCounts: Record<string, Record<string, number>>;
  onStartToday: () => void;
  startingMission: boolean;
};

export function SmartStudyCalendar({
  examDate,
  studyDays,
  dailyQuota,
  dailyNewQuota,
  dailyReviewQuota,
  remainingQuestions,
  triageWeeks,
  subjectMode,
  subjectQuotas,
  subjects,
  subjectsWithRemaining,
  subjectConfidence,
  dueReviewChapters,
  dailyChapterCounts,
  onStartToday,
  startingMission,
}: Props) {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const todayKey = useMemo(() => toKey(today), [today]);

  const [taskOverrides, setTaskOverrides] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'day' | 'month'>('day');
  const [weekAnchor, setWeekAnchor] = useState<Date>(today);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [guideDate, setGuideDate] = useState<Date | null>(null);
  const [viewMonth, setViewMonth] = useState<{ year: number; month: number }>({ year: today.getFullYear(), month: today.getMonth() });

  const storageKey = user?.id ? `passbar_calendar_task_overrides_${user.id}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setTaskOverrides(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // ignore malformed storage
    }
  }, [storageKey]);

  const locale = LOCALE_MAP[language] ?? 'en-US';

  // Focus subjects ordered by allocated quota (weakest/highest-need first)
  const focusSubjects = useMemo(() => {
    return subjectsWithRemaining
      .filter((s) => s.remaining > 0)
      .sort((a, b) => (subjectQuotas[b.name] ?? 0) - (subjectQuotas[a.name] ?? 0))
      .map((s) => s.name);
  }, [subjectsWithRemaining, subjectQuotas]);
  const subjectByName = useMemo(() => new Map(subjects.map((subject) => [subject.name, subject])), [subjects]);

  const examDateObj = examDate ? startOfLocalDay(new Date(examDate + 'T00:00:00')) : null;
  const examDateKey = examDateObj ? toKey(examDateObj) : null;
  const daysRemaining = examDateObj
    ? Math.round((examDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  if (!examDateObj) {
    return (
      <Card className="border-primary/20 bg-primary/5 shadow-sm transition-all duration-500 hover:shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            {t('calendar.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('calendar.noExamDate')}</p>
        </CardContent>
      </Card>
    );
  }

  if (dailyQuota === 0 || (focusSubjects.length === 0 && dueReviewChapters.length === 0)) {
    return (
      <Card className="border-primary/20 bg-primary/5 shadow-sm transition-all duration-500 hover:shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            {t('calendar.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-2">
          <CheckCircle2 className="mx-auto h-8 w-8 mb-2 text-green-700 opacity-80" />
          <p className="text-sm font-semibold text-green-700">{t('plan.allDoneTitle')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('plan.allDoneDescription')}</p>
        </CardContent>
      </Card>
    );
  }

  // The bar exam runs two consecutive days — treat both as "exam days".
  const examDay2Obj = addDays(examDateObj, 1);
  const examDay2Key = toKey(examDay2Obj);

  // Returns 1 or 2 if `dateKey` is the first/second day of the (two-day) bar exam, else 0.
  const examDayNumber = (dateKey: string): number => {
    if (dateKey === examDateKey) return 1;
    if (dateKey === examDay2Key) return 2;
    return 0;
  };

  // Number of study-days between "today" (inclusive) and the given date (exclusive),
  // used to keep the focus-subject rotation consistent across day/week/month views.
  const focusIndexForDate = (date: Date): number => {
    let idx = 0;
    const cursor = new Date(today);
    while (cursor < date) {
      if (studyDays.includes(cursor.getDay())) idx += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return idx;
  };

  const isMixedDate = (date: Date) => {
    const daysUntilExam = Math.round((examDateObj.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    return subjectMode === 'mixed' || daysUntilExam <= triageWeeks * 7;
  };

  const focusForDate = (date: Date): { name: string | null; color: string; mixed: boolean } => {
    if (focusSubjects.length === 0) return { name: null, color: '', mixed: false };
    if (isMixedDate(date)) {
      const idx = focusIndexForDate(date) % focusSubjects.length;
      return { name: focusSubjects[idx], color: SUBJECT_BADGE_COLORS[idx % SUBJECT_BADGE_COLORS.length], mixed: true };
    }

    const focus = getFocusSubjectForDate(subjectsWithRemaining, subjectConfidence, studyDays, date) ?? focusSubjects[0];
    const idx = Math.max(0, focusSubjects.indexOf(focus));
    return { name: focus, color: SUBJECT_BADGE_COLORS[idx % SUBJECT_BADGE_COLORS.length], mixed: false };
  };

  const chaptersForSubject = (subjectName: string | null, date: Date) => {
    if (!subjectName) return [];
    const subject = subjectByName.get(subjectName);
    if (!subject) return [];
    const chapters = subject.chapters.filter((chapter) => chapter.count > 0);
    if (chapters.length === 0) return [];
    const start = focusIndexForDate(date) % chapters.length;
    return Array.from({ length: Math.min(2, chapters.length) }, (_, offset) => chapters[(start + offset) % chapters.length]);
  };

  const addTargets = <T extends Omit<PlannedTask, 'target'>>(items: T[], total: number): PlannedTask[] => {
    if (items.length === 0 || total <= 0) return [];
    const allocatedItems = items.slice(0, total);
    const base = Math.floor(total / allocatedItems.length);
    const remainder = total % allocatedItems.length;
    return allocatedItems.map((item, index) => ({
      ...item,
      target: base + (index < remainder ? 1 : 0),
    }));
  };

  const planForDate = (date: Date) => {
    const focus = focusForDate(date);
    const quota = quotaPlanForDate(date);
    const studyDayIndex = focusIndexForDate(date);
    const mixed = focus.mixed;
    const rawNewItems: Array<Omit<PlannedTask, 'target'>> = mixed
      ? focusSubjects.slice(0, Math.min(3, focusSubjects.length)).flatMap((subjectName) => (
        chaptersForSubject(subjectName, date).slice(0, 1).map((chapter) => ({
          kind: 'new' as const,
          subject: subjectName,
          chapterId: chapter.id,
          chapter: chapter.name,
        }))
      ))
      : chaptersForSubject(focus.name, date).map((chapter) => ({
        kind: 'new' as const,
        subject: focus.name ?? '',
        chapterId: chapter.id,
        chapter: chapter.name,
      }));

    const rawReviewItems: Array<Omit<PlannedTask, 'target'>> = dueReviewChapters.length > 0
      ? Array.from({ length: Math.min(2, dueReviewChapters.length) }, (_, offset) => {
        const review = dueReviewChapters[(studyDayIndex + offset) % dueReviewChapters.length];
        return {
          kind: 'review' as const,
          subject: review.subject,
          chapterId: review.chapterId,
          chapter: review.chapterName,
          accuracy: review.accuracy,
          days: review.daysSinceLastAttempt,
          averageSeconds: review.averageSeconds,
          masteryRate: review.masteryRate,
        };
      })
      : [];

    const newItems = addTargets(rawNewItems, quota.newQuota);
    const reviewItems = addTargets(rawReviewItems, quota.reviewQuota);
    return { focus, quota, newItems, reviewItems };
  };

  const taskKey = (dateKey: string, task: PlannedTask) => `${dateKey}|${task.kind}|${task.chapterId}`;

  const actualTaskCount = (dateKey: string, task: PlannedTask) => (
    dailyChapterCounts[dateKey]?.[task.chapterId] ?? 0
  );

  const isTaskCompleted = (dateKey: string, task: PlannedTask) => {
    const key = taskKey(dateKey, task);
    if (Object.prototype.hasOwnProperty.call(taskOverrides, key)) return taskOverrides[key];
    return actualTaskCount(dateKey, task) >= task.target;
  };

  const toggleTaskCompletion = (dateKey: string, task: PlannedTask) => {
    if (!storageKey) return;
    const key = taskKey(dateKey, task);
    const nextValue = !isTaskCompleted(dateKey, task);
    setTaskOverrides((current) => {
      const next = { ...current, [key]: nextValue };
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const progressForDate = (date: Date) => {
    const plan = planForDate(date);
    const tasks = [...plan.newItems, ...plan.reviewItems];
    const dateKey = toKey(date);
    const completed = tasks.filter((task) => isTaskCompleted(dateKey, task)).length;
    return { completed, total: tasks.length, tasks };
  };

  const isCompleted = (date: Date) => {
    const progress = progressForDate(date);
    return progress.total > 0 && progress.completed === progress.total;
  };

  const openGuide = (date: Date) => {
    setSelectedDate(date);
    setGuideDate(date);
  };

  // The dashboard quota is the authoritative daily plan. It already includes
  // study-time limits and the Ebbinghaus review reserve. Reusing it here avoids
  // inflating future dates by recalculating against an unchanged remaining count.
  const quotaPlanForDate = (date: Date): { total: number; newQuota: number; reviewQuota: number } => {
    if (date >= examDateObj) return { total: 0, newQuota: 0, reviewQuota: 0 };

    const newQuota = Math.min(dailyNewQuota, remainingQuestions);
    const reviewQuota = dueReviewChapters.length > 0 ? dailyReviewQuota : 0;
    return { total: newQuota + reviewQuota, newQuota, reviewQuota };
  };

  // ── Day view data ──────────────────────────────────────────────────────
  const weekDays = getWeekDays(weekAnchor);
  const selectedKey = toKey(selectedDate);
  const isSelectedToday = selectedKey === todayKey;
  const isSelectedStudyDay = studyDays.includes(selectedDate.getDay());
  const selectedCompleted = isCompleted(selectedDate);
  const selectedFocus = focusForDate(selectedDate);
  const selectedPlan = planForDate(selectedDate);
  const selectedProgress = progressForDate(selectedDate);
  const selectedExamDayNum = examDayNumber(selectedKey);

  const weekRangeFullLabel = `${new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(weekDays[0])} ${new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(weekDays[0])} - ${new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(weekDays[6])}`;
  const isoWeek = getISOWeekNumber(weekDays[0]);
  const isNextWeekDisabled = weekDays[0] > examDay2Obj;

  const shiftWeek = (delta: number) => {
    setWeekAnchor((d) => addDays(d, delta * 7));
    setSelectedDate((d) => addDays(d, delta * 7));
  };

  const focusDisplayName = (name: string) => {
    const zhLabel = getMbeChineseLabel(name, language);
    return zhLabel ? `${name} (${zhLabel})` : name;
  };

  const goToFocusSubject = (subjectName: string) => {
    router.push(`/create?subject=${encodeURIComponent(subjectName)}`);
  };

  // ── Month view data ────────────────────────────────────────────────────
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(viewMonth.year, viewMonth.month, 1));
  const isAtCurrentMonth = viewMonth.year === today.getFullYear() && viewMonth.month === today.getMonth();
  const isSprintMonth = examDateObj.getFullYear() === viewMonth.year && examDateObj.getMonth() === viewMonth.month;
  const isExamDay2Month = examDay2Obj.getFullYear() === viewMonth.year && examDay2Obj.getMonth() === viewMonth.month;
  const weeks = buildMonthGrid(viewMonth.year, viewMonth.month);
  const mobileAgendaDays = weeks
    .flat()
    .filter((cell) => (
      cell.inCurrentMonth
      && studyDays.includes(cell.date.getDay())
      && cell.date >= today
      && cell.date <= examDay2Obj
    ));

  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm transition-all duration-500 hover:shadow-md overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            {t('calendar.title')}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs gap-1.5 shrink-0"
            onClick={() => setViewMode((mode) => (mode === 'day' ? 'month' : 'day'))}
          >
            {viewMode === 'day' ? (
              <>
                <LayoutGrid className="h-3.5 w-3.5" />
                {t('calendar.viewFullMonth')}
              </>
            ) : (
              <>
                <ChevronLeft className="h-3.5 w-3.5" />
                {t('calendar.viewToday')}
              </>
            )}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('calendar.description')}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            🎯 {t('calendar.dailyGoalBadge', { quota: dailyQuota })}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
            📝 {t('calendar.newQuestionsBadge', { count: dailyNewQuota })}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
            🔄 {t('calendar.reviewQuestionsBadge', { count: dailyReviewQuota })}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
            ☕ {t('plan.studyDaysSummary', { days: studyDays.length, restDays: 7 - studyDays.length })}
          </span>
        </div>
      </CardHeader>
      {viewMode === 'day' ? (
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-[#E8E2D9] bg-[#FCFAF5] p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => shiftWeek(-1)} aria-label="Previous week">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-800">
                  <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{weekRangeFullLabel}</span>
                </span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => shiftWeek(1)} disabled={isNextWeekDisabled} aria-label="Next week">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">{t('calendar.weekNumber', { week: isoWeek })}</span>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center">
              {weekDays.map((d) => {
                const key = toKey(d);
                const dow = d.getDay();
                const isStudy = studyDays.includes(dow);
                const isToday = key === todayKey;
                const isSelected = key === selectedKey;
                const completed = isCompleted(d);
                const progress = progressForDate(d);
                const isExamDay = examDayNumber(key) > 0;
                const isPast = d < today;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDate(d)}
                    className="flex flex-col items-center gap-1 rounded-lg p-1 hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-[10px] font-medium text-muted-foreground">{t(DAY_KEYS[dow])}</span>
                    <div
                      className={cn(
                        'relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                        isToday ? 'bg-primary text-primary-foreground' : 'text-slate-700',
                        !isToday && completed && 'bg-green-100 text-green-700',
                        isExamDay && 'bg-amber-100 text-amber-700',
                        !isToday && isSelected && !completed && 'ring-2 ring-primary/50',
                        isToday && isSelected && 'ring-2 ring-primary ring-offset-1',
                      )}
                    >
                      {isExamDay ? <PartyPopper className="h-4 w-4" /> : completed && !isToday ? <CheckCircle2 className="h-4 w-4" /> : d.getDate()}
                    </div>
                    <div className="flex h-3.5 items-center justify-center">
                      {isExamDay ? null : isStudy ? (
                        !completed && (
                          progress.completed > 0
                            ? <span className="text-[10px] font-semibold text-primary">{progress.completed}/{progress.total}</span>
                            : isPast
                              ? <span className="h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden />
                              : <CheckCircle2 className={cn('h-3.5 w-3.5', isToday ? 'text-primary' : 'text-primary/60')} />
                        )
                      ) : (
                        <Coffee className="h-3.5 w-3.5 text-muted-foreground/40" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <hr className="border-slate-100" />

          <DayAgendaContent date={selectedDate} />
        </CardContent>
      ) : (
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-[#E8E2D9] bg-[#FCFAF5] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100/50">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => shiftMonth(-1)} disabled={isAtCurrentMonth} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="text-sm font-bold text-slate-800">
              {monthLabel}
              {isSprintMonth && (
                <span className="ml-2 text-xs font-semibold text-amber-600">({t('calendar.sprintMonth')})</span>
              )}
            </p>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => shiftMonth(1)} disabled={isSprintMonth || isExamDay2Month} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>


          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground border-b border-slate-100 mt-2">
            {DAY_KEYS.map((dayKey) => (
              <div key={dayKey} className="py-2">{t(dayKey)}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {weeks.flatMap((week) =>
              week.map((cell) => {
                if (!cell.inCurrentMonth) {
                  return <div key={cell.key} className="min-h-12 border-b border-r border-slate-100 bg-slate-50/40 sm:min-h-[7rem]" />;
                }

                const dow = cell.date.getDay();
                const isStudyDay = studyDays.includes(dow);
                const isToday = cell.key === todayKey;
                const isPast = cell.date < today;
                const isFuture = cell.date > today;
                const completed = isCompleted(cell.date);
                const progress = progressForDate(cell.date);
                const examDayNum = examDayNumber(cell.key);
                const isExamDay = examDayNum > 0;
                const isAfterExam = cell.date > examDay2Obj;

                let focus: { name: string | null; color: string; mixed: boolean } = { name: null, color: '', mixed: false };
                let mission = planForDate(cell.date);
                if (isStudyDay && (isToday || isFuture)) {
                  focus = focusForDate(cell.date);
                  mission = planForDate(cell.date);
                }

                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={cell.key}
                    onClick={() => {
                      setSelectedDate(cell.date);
                      if (!isExamDay && !isAfterExam && isStudyDay && window.innerWidth < 640) openGuide(cell.date);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      setSelectedDate(cell.date);
                      if (!isExamDay && !isAfterExam && isStudyDay && window.innerWidth < 640) openGuide(cell.date);
                    }}
                    className={cn(
                      'min-h-12 border-b border-r border-slate-100 p-1.5 flex flex-col gap-1.5 text-left transition-colors sm:min-h-[7rem] sm:p-2',
                      isToday && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                      !isStudyDay && 'bg-slate-50/40',
                      !isExamDay && !isAfterExam && isStudyDay && 'hover:bg-primary/5',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn('text-xs font-medium', isToday ? 'text-primary font-bold' : 'text-slate-500')}>
                        {cell.date.getDate()}
                        {isToday && <span className="ml-1">({t('calendar.today')})</span>}
                      </span>
                      {completed && (
                        <span className="inline-flex items-center gap-0.5 rounded-md border border-green-200 bg-green-100 p-1 text-[10px] font-semibold text-green-700 sm:px-1.5 sm:py-0.5">
                          <CheckCircle2 className="h-3 w-3 sm:h-2.5 sm:w-2.5" />
                          <span className="hidden sm:inline">{t('calendar.completed')}</span>
                        </span>
                      )}
                      {!completed && progress.completed > 0 && (
                        <span className="text-[10px] font-semibold text-primary">{progress.completed}/{progress.total}</span>
                      )}
                    </div>

                    {isExamDay && (
                      <div className="flex flex-1 flex-col items-center justify-center gap-0.5 text-center">
                        <PartyPopper className="h-4 w-4 text-amber-500 sm:h-5 sm:w-5" />
                        <span className="hidden text-[10px] font-bold text-amber-600 sm:inline">{t('calendar.examDayNum', { day: examDayNum })}</span>
                      </div>
                    )}

                    {!isExamDay && !isAfterExam && isStudyDay && !completed && (isToday || isFuture) && (
                      <div className="mt-auto flex flex-col gap-1.5">
                        <CompactMissionSummary plan={mission} />
                        {isToday && (
                          <Button
                            size="sm"
                            className="h-7 px-2 text-[11px] gap-1"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onStartToday();
                            }}
                            disabled={startingMission}
                          >
                            {startingMission ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                            {t('calendar.startNow')}
                          </Button>
                        )}
                      </div>
                    )}

                  </div>
                );
              }),
            )}
          </div>

        </div>
        
        <div className="hidden sm:block mt-6">
          {selectedDate && <DayAgendaContent date={selectedDate} />}
        </div>
      </CardContent>
      )}
      <Dialog open={Boolean(guideDate)} onOpenChange={(open) => !open && setGuideDate(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[85vh] overflow-y-auto p-0 border-none bg-transparent shadow-none">
          <DialogTitle className="sr-only">任務明細</DialogTitle>
          {guideDate && <EnhancedTaskDetails date={guideDate} plan={planForDate(guideDate)} inModal />}
        </DialogContent>
      </Dialog>
    </Card>
  );

  function DayAgendaContent({ date }: { date: Date }) {
    const isAgendaToday = toKey(date) === todayKey;
    const isAgendaStudyDay = studyDays.includes(date.getDay());
    const agendaCompleted = isCompleted(date);
    const agendaFocus = focusForDate(date);
    const agendaPlan = planForDate(date);
    const agendaProgress = progressForDate(date);
    const agendaExamDayNum = examDayNumber(toKey(date));

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-amber-500" />
            <div className="text-base font-bold text-slate-800">
              {new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date)}
              {isAgendaToday && <span className="ml-1 text-xs font-medium text-primary">({t('calendar.today')})</span>}
            </div>
          </div>
          {agendaExamDayNum === 0 && isAgendaStudyDay && (
            <span className={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold',
              agendaCompleted ? 'bg-green-100 text-green-700' : 'bg-[#FDF6E3] text-[#B58529]',
            )}>
              {agendaCompleted
                ? t('calendar.completed')
                : `已完成 ${agendaProgress.completed}/${agendaProgress.total} 個章節任務`}
            </span>
          )}
        </div>
        
        <hr className="border-slate-100" />

        {agendaExamDayNum > 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-4 py-6 text-center">
            <PartyPopper className="h-9 w-9 text-amber-500" />
            <p className="text-sm font-bold text-amber-600">{t('calendar.examDayNum', { day: agendaExamDayNum })}</p>
            <p className="text-sm text-muted-foreground">{t('calendar.examDayMessage')}</p>
          </div>
        ) : !isAgendaStudyDay ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-muted-foreground">{t('calendar.restDay')}</p>
        ) : (
          <>
            <div className="hidden sm:block mt-4">
              <EnhancedTaskDetails date={date} plan={agendaPlan} showHeader={false} />
            </div>

            {agendaFocus.name && (
              <>
                <hr className="border-slate-100 my-2" />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 truncate text-sm text-slate-500 flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                    今日核心攻克：{focusDisplayName(agendaFocus.name)}
                  </p>
                  <Button
                    size="sm"
                    className="group shrink-0 gap-1.5 bg-[#CBA344] hover:bg-[#B38F39] text-white"
                    type="button"
                    onClick={() => goToFocusSubject(agendaFocus.name as string)}
                  >
                    <Search className="h-4 w-4" />
                    進入單科專攻：{agendaFocus.name}
                  </Button>
                </div>
              </>
            )}

            {isAgendaToday && !agendaCompleted && (
              <Button
                size="sm"
                className="h-9 gap-1.5 px-4 text-xs mt-2"
                type="button"
                onClick={onStartToday}
                disabled={startingMission}
              >
                {startingMission ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                {t('calendar.startNow')}
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  function Stat({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xs font-semibold text-slate-700">{value}</p>
      </div>
    );
  }

  function EnhancedTaskDetails({ date, plan, inModal = false, showHeader = true }: { date: Date; plan: ReturnType<typeof planForDate>; inModal?: boolean; showHeader?: boolean }) {
    const totalChapters = plan.newItems.length + plan.reviewItems.length;
    
    if (totalChapters === 0) return null;

    const dateLabel = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);

    return (
      <div className={cn("bg-white", inModal ? "rounded-2xl border border-slate-200 p-4 sm:p-5 pt-6 sm:pt-6" : "")}>
        {showHeader && (
          <div className={cn("flex items-center justify-between mb-4 gap-2", inModal ? "pr-8 sm:pr-8" : "")}>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-1.5 h-6 bg-[#B58529] rounded-full shrink-0" />
              <h3 className="text-lg font-bold text-slate-800 truncate">{dateLabel} 任務明細</h3>
            </div>
            <div className="bg-[#FDF6E3] text-[#B58529] px-3 py-1 rounded-full text-xs sm:text-sm font-bold shrink-0">
              共 {totalChapters} 個單元
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 items-stretch mt-2">
          <TaskColumn kind="new" items={plan.newItems} />
          <TaskColumn kind="review" items={plan.reviewItems} />
        </div>
      </div>
    );
  }

  function TaskColumn({ kind, items }: { kind: PlannedTask['kind']; items: PlannedTask[] }) {
    const isReview = kind === 'review';
    const Icon = isReview ? RotateCcw : BookOpen;
    const totalQuestions = items.reduce((sum, item) => sum + item.target, 0);

    return (
      <div className="flex flex-col space-y-3 h-full">
        <div className="flex items-center justify-between gap-2 px-1 shrink-0">
          <span className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
            <Icon className={cn('h-4 w-4', isReview ? 'text-slate-500' : 'text-slate-500')} />
            {isReview ? t('calendar.reviewStudy') : t('calendar.newStudy')}
          </span>
          {items.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
              {t('calendar.chapterTaskCount', { chapters: items.length, questions: totalQuestions })}
            </span>
          )}
        </div>
        <div className="space-y-3 flex-1 flex flex-col">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1">{isReview ? t('calendar.noReviewDue') : t('calendar.noNewStudy')}</p>
          ) : items.map((item, index) => {
            return (
            <div key={`${item.kind}-${item.chapterId}`} className={cn(
              "rounded-xl border p-4 flex items-start gap-3 shadow-sm transition-all duration-200 text-left group cursor-pointer",
              isReview ? "bg-[#fcfbfa] hover:bg-[#faf8f2] border-[#e8e2d9] border-dashed" : "bg-[#fcfbfa] hover:bg-[#faf8f2] border-[#f0eee9]",
              index === items.length - 1 ? "flex-1" : ""
            )}>
              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0 mt-[6px]", isReview ? "bg-[#ea580c]" : "bg-[#c29d4c]")} />
              <div className="flex-1 space-y-3 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1.5 pt-0.5">
                    <p className="truncate text-[15px] font-bold leading-none transition-colors text-[#1e1c19] group-hover:text-[#c29d4c]">
                      {item.subject}
                    </p>
                    <p className="truncate text-[13px] leading-none text-[#7c7871]">{item.chapter}</p>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-md px-2.5 py-1 text-xs font-bold tabular-nums transition-colors",
                    isReview ? "bg-[#c29d4c] text-white" : "bg-[#f0eee9] text-[#5e5b54] group-hover:bg-[#fdf6e3] group-hover:text-[#c29d4c]"
                  )}>
                    {item.target} {t('plan.questionsUnit')}
                  </span>
                </div>
              {isReview && (
                (item.masteryRate ?? 0) > 0 ? (
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#f0eee9]/40 px-2 py-1.5 text-center mt-3">
                    <Stat label={t('calendar.accuracyLabel')} value={`${item.accuracy ?? 0}%`} />
                    <Stat label={t('calendar.avgTimeLabel')} value={t('calendar.secondsShort', { seconds: Math.round(item.averageSeconds ?? 0) })} />
                    <Stat label={t('calendar.masteryLevelLabel')} value={`${item.masteryRate}%`} />
                  </div>
                ) : (
                  <div className="space-y-1.5 rounded-lg bg-[#f0eee9]/40 px-2 py-1.5 mt-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Stat label={t('calendar.accuracyLabel')} value="—" />
                      <Stat label={t('calendar.avgTimeLabel')} value="—" />
                      <Stat
                        label={t('calendar.masteryLevelLabel')}
                        value={(
                          <span className="inline-flex items-center gap-0.5 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            {t('calendar.pendingPractice')}
                          </span>
                        )}
                      />
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 text-[11px]">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden />
                        {t('calendar.noHistoryData')}
                      </span>
                      <Link href="/topic-study" className="font-semibold text-primary hover:underline">
                        {t('calendar.unlockPractice')} →
                      </Link>
                    </div>
                  </div>
                )
              )}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    );
  }

  function getShortSubjectName(name: string) {
    if (name.includes('Criminal')) return 'Crim Law';
    if (name.includes('Constitutional')) return 'Con Law';
    if (name.includes('Civil Procedure')) return 'Civ Pro';
    if (name.includes('Real Property')) return 'Real Prop';
    if (name.includes('Contracts')) return 'Contracts';
    if (name.includes('Evidence')) return 'Evidence';
    if (name.includes('Torts')) return 'Torts';
    return name;
  }

  function getSubjectColorStyles(name: string) {
    const shortName = getShortSubjectName(name);
    switch (shortName) {
      case 'Crim Law': return { stripe: 'border-l-blue-500 bg-blue-50 text-blue-700', dot: 'bg-blue-500' };
      case 'Con Law': return { stripe: 'border-l-amber-500 bg-amber-50 text-amber-700', dot: 'bg-amber-500' };
      case 'Civ Pro': return { stripe: 'border-l-emerald-500 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
      case 'Real Prop': return { stripe: 'border-l-cyan-500 bg-cyan-50 text-cyan-700', dot: 'bg-cyan-500' };
      case 'Contracts': return { stripe: 'border-l-violet-500 bg-violet-50 text-violet-700', dot: 'bg-violet-500' };
      case 'Evidence': return { stripe: 'border-l-rose-500 bg-rose-50 text-rose-700', dot: 'bg-rose-500' };
      case 'Torts': return { stripe: 'border-l-orange-500 bg-orange-50 text-orange-700', dot: 'bg-orange-500' };
      default: return { stripe: 'border-l-slate-400 bg-slate-50 text-slate-700', dot: 'bg-slate-500' };
    }
  }

  function CompactMissionSummary({ plan }: { plan: ReturnType<typeof planForDate> }) {
    const firstNew = plan.newItems[0];
    const firstReview = plan.reviewItems[0];
    return (
      <div className="space-y-0.5 mt-auto w-full flex flex-col items-start sm:items-stretch">
        <div className="hidden sm:flex flex-col space-y-0.5 w-full">
          {firstNew && (
            <div className={cn("text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 border-l-2 -mx-1.5 sm:-mx-2 truncate", getSubjectColorStyles(firstNew.subject).stripe)}>
              <span className="font-normal opacity-80 mr-1">新</span>
              {getShortSubjectName(firstNew.subject)}
            </div>
          )}
          {firstReview && (
            <div className={cn("text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 border-l-2 -mx-1.5 sm:-mx-2 truncate", getSubjectColorStyles(firstReview.subject).stripe)}>
              <span className="font-normal opacity-80 mr-1">複</span>
              {getShortSubjectName(firstReview.subject)}
            </div>
          )}
        </div>
        
        {/* Mobile Dots Mode */}
        <div className="sm:hidden flex flex-wrap gap-1 w-full pt-1 pl-1">
          {firstNew && (
            <div className={cn("w-2 h-2 rounded-full shrink-0", getSubjectColorStyles(firstNew.subject).dot)} />
          )}
          {firstReview && (
            <div className={cn("w-2 h-2 rounded-full shrink-0", getSubjectColorStyles(firstReview.subject).dot)} />
          )}
        </div>
      </div>
    );
  }
}
