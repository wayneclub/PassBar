"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, LayoutGrid, Loader2, PartyPopper, Rocket, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/components/AuthProvider';
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

  const weekRangeLabel = `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(weekDays[0])} – ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(weekDays[6])}`;
  const isNextWeekDisabled = weekDays[0] > examDay2Obj;

  const shiftWeek = (delta: number) => {
    setWeekAnchor((d) => addDays(d, delta * 7));
    setSelectedDate((d) => addDays(d, delta * 7));
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
    <Card className="border-primary/20 bg-primary/5 shadow-sm transition-all duration-500 hover:shadow-md overflow-hidden">
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
          {t('calendar.description', { quota: dailyQuota, newQuota: dailyNewQuota, reviewQuota: dailyReviewQuota })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('plan.studyDaysSummary', { days: studyDays.length, restDays: 7 - studyDays.length })}
        </p>
      </CardHeader>
      {viewMode === 'day' ? (
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => shiftWeek(-1)} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-semibold text-slate-600">{weekRangeLabel}</span>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => shiftWeek(1)} disabled={isNextWeekDisabled} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
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
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className="flex flex-col items-center gap-1"
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
                  {isStudy && !completed && !isExamDay && (
                    progress.completed > 0
                      ? <span className="text-[10px] font-semibold text-primary">{progress.completed}/{progress.total}</span>
                      : <CheckCircle2 className={cn('h-3.5 w-3.5', isToday ? 'text-primary' : 'text-primary/60')} />
                  )}
                </button>
              );
            })}
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => openGuide(selectedDate)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') openGuide(selectedDate);
            }}
            className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <p className="text-sm font-bold text-slate-800">
              {new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(selectedDate)}
              {isSelectedToday && <span className="ml-1 text-xs font-medium text-primary">({t('calendar.today')})</span>}
            </p>
            {selectedExamDayNum > 0 ? (
              <div className="flex flex-col items-center text-center gap-1.5 mt-2 py-2">
                <PartyPopper className="h-9 w-9 text-amber-500" />
                <p className="text-sm font-bold text-amber-600">{t('calendar.examDayNum', { day: selectedExamDayNum })}</p>
                <p className="text-sm text-muted-foreground">{t('calendar.examDayMessage')}</p>
              </div>
            ) : !isSelectedStudyDay ? (
              <p className="text-sm text-muted-foreground mt-2">{t('calendar.restDay')}</p>
            ) : (
              <div className="flex flex-col gap-2 mt-3">
                <p className={cn(
                  'text-xs font-semibold',
                  selectedCompleted ? 'text-green-700' : 'text-muted-foreground',
                )}>
                  {selectedCompleted
                    ? t('calendar.completed')
                    : t('calendar.taskProgress', { completed: selectedProgress.completed, total: selectedProgress.total })}
                </p>
                <DayMissionSummary plan={selectedPlan} />
                {selectedFocus.name && (
                  <span className={cn('inline-flex items-center gap-1 self-start rounded-md border px-1.5 py-0.5 text-xs font-semibold', selectedFocus.color)}>
                    <span aria-hidden>🔍</span>
                    {selectedFocus.mixed ? t('calendar.focusMixed', { subject: selectedFocus.name }) : t('calendar.focusSingle', { subject: selectedFocus.name })}
                  </span>
                )}
                {isSelectedToday && !selectedCompleted && (
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs gap-1.5 self-start mt-1"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartToday();
                    }}
                    disabled={startingMission}
                  >
                    {startingMission ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                    {t('calendar.startNow')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      ) : (
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
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
          {isAtCurrentMonth && daysRemaining !== null && (
            <div className="px-4 pt-2">
              <span className="text-xs text-muted-foreground">{t('calendar.daysRemaining', { count: daysRemaining })}</span>
            </div>
          )}

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
                      if (!isExamDay && !isAfterExam && isStudyDay) openGuide(cell.date);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      setSelectedDate(cell.date);
                      if (!isExamDay && !isAfterExam && isStudyDay) openGuide(cell.date);
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
                      <div className="mt-auto hidden flex-col gap-1.5 sm:flex">
                        <CompactMissionSummary plan={mission} />
                        {focus.name && (
                          <span className={cn('inline-flex items-center gap-1 self-start rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', focus.color)}>
                            {isToday && <span aria-hidden>🔍</span>}
                            {isToday
                              ? (focus.mixed ? t('calendar.focusMixed', { subject: focus.name }) : t('calendar.focusSingle', { subject: focus.name }))
                              : (focus.mixed ? t('calendar.mixedShort') : focus.name)}
                          </span>
                        )}
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

          <div className="divide-y divide-slate-100 sm:hidden">
            {mobileAgendaDays.map((cell) => {
              const mission = planForDate(cell.date);
              const completed = isCompleted(cell.date);
              const progress = progressForDate(cell.date);
              const examDayNum = examDayNumber(cell.key);
              const firstNew = mission.newItems[0];
              const firstReview = mission.reviewItems[0];

              return (
                <button
                  key={`agenda-${cell.key}`}
                  type="button"
                  onClick={() => examDayNum === 0 && openGuide(cell.date)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-primary/5 disabled:cursor-default"
                  disabled={examDayNum > 0}
                >
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md border text-xs font-semibold',
                    cell.key === todayKey ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-200 bg-white text-slate-700',
                  )}>
                    <span>{t(DAY_KEYS[cell.date.getDay()])}</span>
                    <span>{cell.date.getDate()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    {examDayNum > 0 ? (
                      <p className="text-sm font-semibold text-amber-600">{t('calendar.examDayNum', { day: examDayNum })}</p>
                    ) : completed ? (
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
                        <CheckCircle2 className="h-4 w-4" />
                        {t('calendar.completed')}
                      </p>
                    ) : (
                      <>
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {firstNew ? `${firstNew.subject} · ${firstNew.chapter}` : t('calendar.noNewStudy')}
                        </p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {firstReview
                            ? `${t('calendar.reviewStudy')}：${firstReview.subject} · ${firstReview.chapter}`
                            : t('calendar.noReviewDue')}
                        </p>
                        {progress.completed > 0 && (
                          <p className="mt-1 text-xs font-semibold text-primary">
                            {t('calendar.taskProgress', { completed: progress.completed, total: progress.total })}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {examDayNum === 0 && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-400" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic adjustment note */}
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <CalendarDays className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-800">{t('calendar.infoTitle')}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t('calendar.infoDescription', { date: examDate ?? '' })}
            </p>
          </div>
        </div>
      </CardContent>
      )}
      <Dialog open={Boolean(guideDate)} onOpenChange={(open) => !open && setGuideDate(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {guideDate && <StudyGuideContent date={guideDate} plan={planForDate(guideDate)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );

  function DayMissionSummary({ plan }: { plan: ReturnType<typeof planForDate> }) {
    const MissionSection = ({
      kind,
      items,
    }: {
      kind: PlannedTask['kind'];
      items: PlannedTask[];
    }) => {
      const isReview = kind === 'review';
      const Icon = isReview ? RotateCcw : BookOpen;
      const totalQuestions = items.reduce((sum, item) => sum + item.target, 0);

      return (
        <section className="min-w-0 px-3 py-3 sm:px-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                isReview ? 'bg-amber-100 text-amber-700' : 'bg-primary/10 text-primary',
              )}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">
                  {isReview ? t('calendar.reviewStudy') : t('calendar.newStudy')}
                </p>
                <p className="text-[11px] text-slate-500">
                  {items.length > 0
                    ? `${items.length} · ${totalQuestions} ${t('plan.questionsUnit')}`
                    : (isReview ? t('calendar.noReviewDue') : t('calendar.noNewStudy'))}
                </p>
              </div>
            </div>
          </div>

          {items.length > 0 && (
            <div className="divide-y divide-slate-200/80">
              {items.map((item) => (
                <div
                  key={`${item.kind}-${item.chapterId}`}
                  className="flex items-start justify-between gap-3 py-2 first:pt-1 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-slate-800">{item.subject}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.chapter}</p>
                    {isReview && item.days !== undefined && item.accuracy !== undefined && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        {t('calendar.reviewMeta', {
                          days: item.days,
                          accuracy: item.accuracy,
                          seconds: Math.round(item.averageSeconds ?? 0),
                          mastery: item.masteryRate ?? 0,
                        })}
                      </p>
                    )}
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums',
                    isReview ? 'bg-amber-100 text-amber-800' : 'bg-primary/10 text-primary',
                  )}>
                    {item.target} {t('plan.questionsUnit')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      );
    };

    return (
      <div className="grid overflow-hidden border-y border-slate-200 bg-slate-50/60 md:grid-cols-2 md:divide-x md:divide-slate-200">
        <MissionSection kind="new" items={plan.newItems} />
        <div className="border-t border-slate-200 md:border-t-0">
          <MissionSection kind="review" items={plan.reviewItems} />
        </div>
      </div>
    );
  }

  function CompactMissionSummary({ plan }: { plan: ReturnType<typeof planForDate> }) {
    const firstNew = plan.newItems[0];
    const firstReview = plan.reviewItems[0];
    return (
      <div className="space-y-1">
        {firstNew && (
          <div>
            <p className="text-[10px] font-semibold text-primary">{t('calendar.newStudy')}</p>
            <p className="line-clamp-2 text-[11px] font-bold text-slate-700">{firstNew.subject}</p>
            <p className="line-clamp-2 text-[10px] text-slate-500">{firstNew.chapter}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold text-amber-700">{t('calendar.reviewStudy')}</p>
          <p className="line-clamp-2 text-[10px] text-slate-500">
            {firstReview ? `${firstReview.subject} · ${firstReview.chapter}` : t('calendar.noReviewDue')}
          </p>
        </div>
      </div>
    );
  }

  function StudyGuideContent({ date, plan }: { date: Date; plan: ReturnType<typeof planForDate> }) {
    const dateLabel = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
    const dateKey = toKey(date);

    const TaskRow = ({ task, review = false }: { task: PlannedTask; review?: boolean }) => {
      const actual = actualTaskCount(dateKey, task);
      const completed = isTaskCompleted(dateKey, task);
      const key = taskKey(dateKey, task);
      const hasManualOverride = Object.prototype.hasOwnProperty.call(taskOverrides, key);
      const canManuallyUpdate = date >= today || actual > 0 || hasManualOverride;

      return (
        <div className={cn('rounded-md p-3', review ? 'bg-white' : 'bg-slate-50')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">{task.subject}</p>
              <p className="text-sm text-slate-600">{task.chapter}</p>
              <p className={cn('mt-1 text-xs', completed ? 'font-semibold text-green-700' : 'text-slate-500')}>
                {completed
                  ? t('calendar.chapterCompleted')
                  : t('calendar.chapterProgress', { actual: Math.min(actual, task.target), target: task.target })}
              </p>
              {review && task.days !== undefined && task.accuracy !== undefined && (
                <p className="mt-1 text-xs text-slate-500">
                  {t('calendar.reviewMeta', {
                    days: task.days,
                    accuracy: task.accuracy,
                    seconds: Math.round(task.averageSeconds ?? 0),
                    mastery: task.masteryRate ?? 0,
                  })}
                </p>
              )}
            </div>
            {canManuallyUpdate && (
              <Button
                type="button"
                size="sm"
                variant={completed ? 'outline' : 'default'}
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => toggleTaskCompletion(dateKey, task)}
              >
                {completed ? t('calendar.undoComplete') : t('calendar.markComplete')}
              </Button>
            )}
          </div>
        </div>
      );
    };

    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('calendar.guideTitle', { date: dateLabel })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {t('calendar.guideSubtitle', {
              total: plan.quota.total,
              newQuota: plan.quota.newQuota,
              reviewQuota: plan.quota.reviewQuota,
            })}
          </p>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <BookOpen className="h-4 w-4 text-primary" />
              {t('calendar.guideNewTitle')}
            </h3>
            <div className="mt-3 space-y-2">
              {plan.newItems.map((item) => <TaskRow key={taskKey(dateKey, item)} task={item} />)}
            </div>
          </section>

          <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <RotateCcw className="h-4 w-4 text-amber-600" />
              {t('calendar.guideReviewTitle')}
            </h3>
            <div className="mt-3 space-y-2">
              {plan.reviewItems.length > 0 ? plan.reviewItems.map((item) => (
                <TaskRow key={taskKey(dateKey, item)} task={item} review />
              )) : (
                <p className="text-sm text-slate-600">{t('calendar.noReviewDue')}</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-800">{t('calendar.guideStepsTitle')}</h3>
            <ol className="mt-3 space-y-2 text-sm text-slate-600">
              <li>{t('calendar.guideStepPreview')}</li>
              <li>{t('calendar.guideStepPractice')}</li>
              <li>{t('calendar.guideStepReview')}</li>
            </ol>
          </section>

          {toKey(date) === todayKey && (
            <Button className="w-full gap-2" onClick={onStartToday} disabled={startingMission}>
              {startingMission ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {t('calendar.startNow')}
            </Button>
          )}
        </div>
      </>
    );
  }
}
