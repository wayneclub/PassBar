"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, LayoutGrid, Loader2, PartyPopper, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/components/AuthProvider';

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
  remainingQuestions: number;
  triageWeeks: number;
  subjectQuotas: Record<string, number>;
  subjectsWithRemaining: { name: string; remaining: number }[];
  dailyCounts: Record<string, number>;
  onStartToday: () => void;
  startingMission: boolean;
};

export function SmartStudyCalendar({
  examDate,
  studyDays,
  dailyQuota,
  remainingQuestions,
  triageWeeks,
  subjectQuotas,
  subjectsWithRemaining,
  dailyCounts,
  onStartToday,
  startingMission,
}: Props) {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const todayKey = useMemo(() => toKey(today), [today]);

  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'day' | 'month'>('day');
  const [weekAnchor, setWeekAnchor] = useState<Date>(today);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [viewMonth, setViewMonth] = useState<{ year: number; month: number }>({ year: today.getFullYear(), month: today.getMonth() });

  const storageKey = user?.id ? `passbar_calendar_overrides_${user.id}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setOverrides(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore malformed storage
    }
  }, [storageKey]);

  const toggleOverride = (dateKey: string) => {
    if (!storageKey) return;
    setOverrides((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const locale = LOCALE_MAP[language] ?? 'en-US';

  // Focus subjects ordered by allocated quota (weakest/highest-need first)
  const focusSubjects = useMemo(() => {
    return subjectsWithRemaining
      .filter((s) => s.remaining > 0)
      .sort((a, b) => (subjectQuotas[b.name] ?? 0) - (subjectQuotas[a.name] ?? 0))
      .map((s) => s.name);
  }, [subjectsWithRemaining, subjectQuotas]);

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

  if (dailyQuota === 0 || focusSubjects.length === 0) {
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

  const isCompleted = (dateKey: string) => (dailyCounts[dateKey] ?? 0) > 0 || overrides.has(dateKey);

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

  const focusForDate = (date: Date): { name: string | null; color: string } => {
    if (focusSubjects.length === 0) return { name: null, color: '' };
    const idx = focusIndexForDate(date) % focusSubjects.length;
    return { name: focusSubjects[idx], color: SUBJECT_BADGE_COLORS[idx % SUBJECT_BADGE_COLORS.length] };
  };

  // Count study days strictly between `start` (inclusive) and `end` (exclusive)
  const countStudyDaysBetween = (start: Date, end: Date): number => {
    let count = 0;
    const cursor = new Date(start);
    while (cursor < end) {
      if (studyDays.includes(cursor.getDay())) count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  };

  // Re-runs the same dynamic-quota formula as `calculateDailyQuota`, but anchored
  // on `date` instead of "today" — keeps future-day targets in sync with how
  // Today's Mission recalculates as remaining questions / available days change.
  const quotaForDate = (date: Date): number => {
    if (remainingQuestions <= 0) return 0;
    if (date >= examDateObj) return remainingQuestions;

    const daysUntilExam = Math.round((examDateObj.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    const triageDays = triageWeeks * 7;

    if (daysUntilExam <= triageDays) {
      const availableDays = Math.max(1, countStudyDaysBetween(date, examDateObj));
      return Math.ceil(remainingQuestions / availableDays);
    }

    const endOfPracticePeriod = addDays(examDateObj, -triageDays);
    const availableDays = Math.max(1, countStudyDaysBetween(date, endOfPracticePeriod));
    return Math.ceil(remainingQuestions / availableDays);
  };

  // ── Day view data ──────────────────────────────────────────────────────
  const weekDays = getWeekDays(weekAnchor);
  const selectedKey = toKey(selectedDate);
  const isSelectedToday = selectedKey === todayKey;
  const isSelectedPast = selectedDate < today;
  const isSelectedFuture = selectedDate > today;
  const isSelectedStudyDay = studyDays.includes(selectedDate.getDay());
  const selectedCompleted = isCompleted(selectedKey);
  const selectedFocus = focusForDate(selectedDate);
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
        <p className="text-sm text-muted-foreground mt-0.5">{t('calendar.description', { quota: dailyQuota })}</p>
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
              const completed = isCompleted(key);
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
                    <span className={cn('h-1 w-1 rounded-full', isToday ? 'bg-primary' : 'bg-slate-300')} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
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
            ) : selectedCompleted ? (
              <div className="flex items-center gap-2 mt-2">
                <CheckCircle2 className="h-4 w-4 text-green-700" />
                <p className="text-sm font-semibold text-green-700">
                  {isSelectedToday ? t('calendar.allCaughtUpToday') : t('calendar.completed')}
                </p>
              </div>
            ) : isSelectedPast ? (
              <div className="flex flex-col gap-2 mt-2">
                <p className="text-sm text-muted-foreground">{t('calendar.planned', { count: quotaForDate(selectedDate) })}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs self-start"
                  onClick={() => toggleOverride(selectedKey)}
                >
                  {t('calendar.markComplete')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 mt-2">
                <p className="text-sm font-semibold text-primary">
                  {isSelectedToday ? t('calendar.recommended', { count: dailyQuota }) : t('calendar.planned', { count: quotaForDate(selectedDate) })}
                </p>
                {selectedFocus.name && (
                  <span className={cn('inline-flex items-center gap-1 self-start rounded-md border px-1.5 py-0.5 text-xs font-semibold', selectedFocus.color)}>
                    <span aria-hidden>🔍</span>
                    {t('calendar.focus')}: {selectedFocus.name}
                  </span>
                )}
                {isSelectedToday ? (
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs gap-1.5 self-start mt-1"
                    onClick={onStartToday}
                    disabled={startingMission}
                  >
                    {startingMission ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                    {t('calendar.startNow')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs self-start mt-1"
                    onClick={() => toggleOverride(selectedKey)}
                  >
                    {t('calendar.markComplete')}
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
                  return <div key={cell.key} className="border-b border-r border-slate-100 min-h-[7rem] bg-slate-50/40" />;
                }

                const dow = cell.date.getDay();
                const isStudyDay = studyDays.includes(dow);
                const isToday = cell.key === todayKey;
                const isPast = cell.date < today;
                const isFuture = cell.date > today;
                const completed = isCompleted(cell.key);
                const examDayNum = examDayNumber(cell.key);
                const isExamDay = examDayNum > 0;
                const isAfterExam = cell.date > examDay2Obj;

                let focus: { name: string | null; color: string } = { name: null, color: '' };
                if (isStudyDay && (isToday || isFuture)) {
                  focus = focusForDate(cell.date);
                }

                return (
                  <div
                    key={cell.key}
                    className={cn(
                      'border-b border-r border-slate-100 min-h-[7rem] p-2 flex flex-col gap-1.5',
                      isToday && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                      !isStudyDay && 'bg-slate-50/40',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn('text-xs font-medium', isToday ? 'text-primary font-bold' : 'text-slate-500')}>
                        {cell.date.getDate()}
                        {isToday && <span className="ml-1">({t('calendar.today')})</span>}
                      </span>
                      {completed && (
                        <span className="inline-flex items-center gap-0.5 rounded-md border border-green-200 bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                          <CheckCircle2 className="h-2.5 w-2.5" /> {t('calendar.completed')}
                        </span>
                      )}
                    </div>

                    {isExamDay && (
                      <div className="flex flex-1 flex-col items-center justify-center gap-0.5 text-center">
                        <PartyPopper className="h-5 w-5 text-amber-500" />
                        <span className="text-[10px] font-bold text-amber-600">{t('calendar.examDayNum', { day: examDayNum })}</span>
                      </div>
                    )}

                    {!isExamDay && !isAfterExam && isStudyDay && !completed && (isToday || isFuture) && (
                      <div className="flex flex-col gap-1.5 mt-auto">
                        {isToday ? (
                          <p className="text-[11px] font-semibold text-primary">{t('calendar.recommended', { count: dailyQuota })}</p>
                        ) : (
                          <p className="text-[11px] text-slate-500">{t('calendar.planned', { count: quotaForDate(cell.date) })}</p>
                        )}
                        {focus.name && (
                          <span className={cn('inline-flex items-center gap-1 self-start rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', focus.color)}>
                            {isToday && <span aria-hidden>🔍</span>}
                            {isToday ? `${t('calendar.focus')}: ${focus.name}` : focus.name}
                          </span>
                        )}
                        {isToday ? (
                          <Button
                            size="sm"
                            className="h-7 px-2 text-[11px] gap-1"
                            onClick={onStartToday}
                            disabled={startingMission}
                          >
                            {startingMission ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                            {t('calendar.startNow')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => toggleOverride(cell.key)}
                          >
                            {t('calendar.markComplete')}
                          </Button>
                        )}
                      </div>
                    )}

                    {isStudyDay && isPast && !completed && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] mt-auto self-start"
                        onClick={() => toggleOverride(cell.key)}
                      >
                        {t('calendar.markComplete')}
                      </Button>
                    )}
                  </div>
                );
              }),
            )}
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
    </Card>
  );
}
