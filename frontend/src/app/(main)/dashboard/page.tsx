"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Cpu,
  Database,
  Flag,
  Flame,
  Gauge,
  GripVertical,
  Hourglass,
  Layers,
  Loader2,
  Lock,
  Play,
  Repeat2,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { CHAPTER_ZH, localizeLabel, SUBJECT_ZH } from '@/lib/subject-translations';
import { GuidedTour, GuidedTourStep } from '@/components/GuidedTour';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getSubjects } from '@/lib/question-bank';
import type { Subject } from '@/lib/types';
import { getQuestionStatusCounts, emptyQuestionStatusCounts, type QuestionStatusCounts } from '@/lib/question-progress';
import { CardCarousel } from '@/components/ui/card-carousel';
import {
  assessQuestionMastery,
  calculateDailyQuota,
  calculatePlannedSubjectQuotas,
  calculateSuggestedSubjectConfidence,
  generateTodayMissionSession,
  generateIncorrectSession,
  getDueReviewChapters,
  getPlannedChapterIdsForDate,
  splitQuotaForReview,
  type ChapterAttemptStats,
} from '@/lib/smart-planner';
import { saveUserStudySettings } from '@/lib/user-settings';
import { saveStudySettings, getStudySettings, normalizeStudySettings, defaultDashboardWidgets, type DashboardWidgetKey, type DashboardWidgetVisibility, type StudyPaceMode, type StudySubjectMode } from '@/lib/study-settings';
import { SmartStudyCalendar } from '@/components/SmartStudyCalendar';

// PracticeAnswerChapterRow is imported from smart-planner

type SubjectPerformance = {
  name: string;
  score: number;
  correct: number;
  total: number;
  fill: string;
};

type DashboardData = {
  loading: boolean;
  error: string | null;
  totalQuestions: number;
  solvedQuestions: number;
  practiceAttempts: number;
  solvedToday: number;
  mastery: number;
  streakDays: number;
  timeTodaySeconds: number;
  subjectPerformance: SubjectPerformance[];
  dailyCounts: Record<string, number>; // "YYYY-MM-DD" → count
  dailyChapterCounts: Record<string, Record<string, number>>; // date → chapter_id → answered count
  recentAccuracy: number | null;       // last-7-day accuracy (null = no recent data)
  incorrectCount: number;              // total incorrect answers
  weeklyStudyTimeSeconds: number;      // study time in last 7 days
  bestStreak: number;                  // longest-ever streak
  avgSecondsPerQuestion: number;       // average time spent per answered question
  chapterStats: ChapterAttemptStats[]; // per-chapter attempt aggregates for spaced review
};

const emptyDashboardData: DashboardData = {
  loading: true,
  error: null,
  totalQuestions: 0,
  solvedQuestions: 0,
  practiceAttempts: 0,
  solvedToday: 0,
  mastery: 0,
  streakDays: 0,
  timeTodaySeconds: 0,
  dailyCounts: {},
  dailyChapterCounts: {},
  subjectPerformance: [],
  recentAccuracy: null,
  incorrectCount: 0,
  weeklyStudyTimeSeconds: 0,
  bestStreak: 0,
  avgSecondsPerQuestion: 0,
  chapterStats: [],
};

const chartColors = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDuration(totalSeconds: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (totalSeconds <= 0) return t('dashboard.durationMin', { m: 0 });
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs    = Math.floor(totalSeconds % 60);
  if (hours > 0 && minutes > 0) return t('dashboard.durationHrMin', { h: hours, m: minutes });
  if (hours > 0)                return t('dashboard.durationHr', { h: hours });
  if (minutes > 0)              return t('dashboard.durationMin', { m: minutes });
  return t('dashboard.durationSec', { s: secs });
}

function calculateStreak(answeredDates: string[]) {
  const answeredDayKeys = new Set(
    answeredDates
      .filter(Boolean)
      .map((value) => startOfLocalDay(new Date(value)).toISOString().slice(0, 10)),
  );

  let streak = 0;
  const cursor = startOfLocalDay(new Date());
  while (answeredDayKeys.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function calculateBestStreak(answeredDates: string[]) {
  const sortedDays = Array.from(new Set(
    answeredDates
      .filter(Boolean)
      .map((v) => startOfLocalDay(new Date(v)).toISOString().slice(0, 10)),
  )).sort();

  let best = 0;
  let current = 0;
  let prevDay: string | null = null;
  for (const day of sortedDays) {
    if (prevDay) {
      const prev = new Date(prevDay);
      prev.setDate(prev.getDate() + 1);
      current = prev.toISOString().slice(0, 10) === day ? current + 1 : 1;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    prevDay = day;
  }
  return best;
}

function displayNameFromProfile(profileName: string | null | undefined, email: string | null | undefined) {
  if (profileName) return profileName.split(/\s+/)[0] || profileName;
  if (email) return email.split('@')[0];
  return 'there';
}

function daysUntilExam(examDate: string): number {
  const today = startOfLocalDay(new Date());
  const exam = startOfLocalDay(new Date(examDate + 'T00:00:00'));
  return Math.round((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

type DashboardStatsResponse = {
  totalQuestions: number;
  solvedQuestions: number;
  practiceAttempts: number;
  solvedToday: number;
  mastery: number;
  streakDays: number;
  timeTodaySeconds: number;
  subjectPerformance: Array<{ name: string; score: number; correct: number; total: number }>;
  dailyCounts: Record<string, number>;
  dailyChapterCounts: Record<string, Record<string, number>>;
  recentAccuracy: number | null;
  incorrectCount: number;
  weeklyStudyTimeSeconds: number;
  bestStreak: number;
  avgSecondsPerQuestion: number;
  chapterStats: ChapterAttemptStats[];
};

async function loadDashboardData(_userId: string): Promise<Omit<DashboardData, 'loading'>> {
  try {
    const data = await api.get<DashboardStatsResponse>('/attempts/dashboard/stats');
    const sortedSubjects = [...data.subjectPerformance].sort((a, b) => a.name.localeCompare(b.name));
    const subjectPerformance = sortedSubjects.map((s, index) => ({
      ...s,
      fill: chartColors[index % chartColors.length],
    }));

    return {
      error: null,
      totalQuestions: data.totalQuestions,
      solvedQuestions: data.solvedQuestions,
      practiceAttempts: data.practiceAttempts,
      solvedToday: data.solvedToday,
      mastery: data.mastery,
      streakDays: data.streakDays,
      timeTodaySeconds: data.timeTodaySeconds,
      subjectPerformance,
      dailyCounts: data.dailyCounts,
      dailyChapterCounts: data.dailyChapterCounts,
      recentAccuracy: data.recentAccuracy,
      incorrectCount: data.incorrectCount,
      weeklyStudyTimeSeconds: data.weeklyStudyTimeSeconds,
      bestStreak: data.bestStreak,
      avgSecondsPerQuestion: data.avgSecondsPerQuestion,
      chapterStats: data.chapterStats,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to load dashboard data.',
      totalQuestions: 0,
      solvedQuestions: 0,
      practiceAttempts: 0,
      solvedToday: 0,
      mastery: 0,
      streakDays: 0,
      timeTodaySeconds: 0,
      subjectPerformance: [],
      dailyCounts: {},
      dailyChapterCounts: {},
      recentAccuracy: null,
      incorrectCount: 0,
      weeklyStudyTimeSeconds: 0,
      bestStreak: 0,
      avgSecondsPerQuestion: 0,
      chapterStats: [],
    };
  }
}

function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const safeTarget = Number.isNaN(target) || target === null || target === undefined ? 0 : target;
    if (safeTarget === 0) { setValue(0); return; }

    const start = Date.now();
    const from = value;
    const diff = safeTarget - from;
    let frameId: number;
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + diff * eased);
      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return Math.round(value);
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const count = useCountUp(value);
  return <>{count.toLocaleString()}{suffix}</>;
}

// ─── Bar Exam date algorithm ────────────────────────────────────────────────
// NY Bar: last Tuesday & Wednesday of February and July
// CA Bar: last Tuesday & Wednesday of February and July (same pattern)
// Both exams start on the Tuesday of the last full Tue-Wed week of Feb / Jul.

function lastTuesdayOfMonth(year: number, month: number): Date {
  // Find last Tuesday (day=2) of the given month
  // month is 0-based (0=Jan, 1=Feb, 6=Jul)
  const lastDay = new Date(year, month + 1, 0); // last day of month
  const dow = lastDay.getDay(); // 0=Sun,1=Mon,2=Tue,...
  const diff = dow >= 2 ? dow - 2 : dow + 5; // days back to reach Tuesday
  return new Date(year, month, lastDay.getDate() - diff);
}

function nextBarExamDate(barType: 'ny' | 'ca'): Date {
  // Both NY and CA follow the same schedule: last Tue of Feb & Jul
  void barType; // same algorithm for both
  const today = startOfLocalDay(new Date());
  const year = today.getFullYear();

  const candidates = [
    lastTuesdayOfMonth(year, 1),     // February this year
    lastTuesdayOfMonth(year, 6),     // July this year
    lastTuesdayOfMonth(year + 1, 1), // February next year
  ];

  // Return the next upcoming date (strictly >= today)
  for (const d of candidates) {
    if (d >= today) return d;
  }
  return candidates[candidates.length - 1];
}

function formatDateDisplay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

// Convert storage format (YYYY-MM-DD) ↔ display format (YYYY/MM/DD)
function isoToDisplay(iso: string) {
  return iso.replace(/-/g, '/');
}
function displayToIso(display: string) {
  return display.replace(/\//g, '-');
}

// Validate YYYY/MM/DD
function isValidDisplayDate(s: string): boolean {
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('/').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// ─── Exam Countdown Badge ────────────────────────────────────────────────────

function ExamCountdownBadge({
  examDate,
  examState,
  onSetDate,
  className,
}: {
  examDate: string | null;
  examState: string | null; // 'ca' | 'ny' | state code | null
  onSetDate: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const days = examDate ? daysUntilExam(examDate) : null;

  // Not set yet → subtle link
  if (days === null) {
    return (
      <button
        onClick={onSetDate}
        className={cn('text-xs text-primary hover:underline font-medium transition-colors', className)}
      >
        ＋ {t('dashboard.setExamDate')}
      </button>
    );
  }

  const stateLabel =
    examState === 'ca' ? 'CA' :
    examState === 'ny' ? 'NY' :
    examState ? examState.toUpperCase() :
    '';

  const examLabel = stateLabel ? `${stateLabel} Bar Exam` : 'Bar Exam';

  const label =
    days < 0
      ? t('dashboard.examCountdownEndedFull', { exam: examLabel })
      : days === 0
        ? t('dashboard.examCountdownTodayFull', { exam: examLabel })
        : t('dashboard.examCountdownFull', { exam: examLabel, days });

  const pillColor =
    days < 0
      ? 'border-slate-300 bg-slate-50 text-slate-500'
      : days === 0
        ? 'border-red-400 bg-red-50 text-red-600'
        : days <= 7
          ? 'border-red-300 bg-red-50 text-red-600'
          : days <= 30
            ? 'border-orange-300 bg-orange-50 text-orange-600'
            : 'border-amber-300/60 bg-white text-amber-600';

  const dotColor =
    days <= 0
      ? 'bg-red-500'
      : days <= 30
        ? 'bg-orange-400 animate-ping'
        : 'bg-amber-400 animate-pulse';

  return (
    <button
      onClick={onSetDate}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all hover:opacity-75 shadow-sm whitespace-nowrap',
        pillColor,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotColor)} />
      {label}
    </button>
  );
}

// ─── Activity Heatmap ────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getCellColor(count: number, max: number): string {
  if (count === 0) return 'bg-slate-100';
  if (max === 0) return 'bg-slate-100';
  const ratio = count / max;
  if (ratio < 0.15) return 'bg-primary/20';
  if (ratio < 0.35) return 'bg-primary/40';
  if (ratio < 0.60) return 'bg-primary/65';
  if (ratio < 0.85) return 'bg-primary/85';
  return 'bg-primary';
}

function buildHeatmapGrid(dailyCounts: Record<string, number>, year: number) {
  type Cell = { date: string; count: number; isCurrentDay: boolean; isFuture: boolean };
  const today = startOfLocalDay(new Date());
  const todayKey = today.toISOString().slice(0, 10);
  const currentYear = today.getFullYear();

  let gridStart: Date;
  let gridEnd: Date;

  if (year === currentYear) {
    // Rolling 53 weeks ending at end of current week
    const dow = today.getDay();
    gridEnd = new Date(today);
    gridEnd.setDate(today.getDate() + (6 - dow));
    gridStart = new Date(gridEnd);
    gridStart.setDate(gridEnd.getDate() - 53 * 7 + 1);
    // Align to Sunday
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  } else {
    // Jan 1 of the year, aligned back to the preceding Sunday
    gridStart = new Date(year, 0, 1);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    gridEnd = new Date(year, 11, 31);
  }

  const weeks: Cell[][] = [];
  const cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const week: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const key = cursor.toISOString().slice(0, 10);
      week.push({
        date: key,
        count: dailyCounts[key] ?? 0,
        isCurrentDay: key === todayKey,
        isFuture: cursor > today,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  // Month labels: find where each month starts
  const monthLabels: { weekIndex: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const month = new Date(week[0].date + 'T00:00:00').getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ weekIndex: wi, label: MONTHS_SHORT[month] });
      lastMonth = month;
    }
  });

  return { weeks, monthLabels };
}

function ActivityHeatmap({
  dailyCounts,
  loading,
  t,
}: {
  dailyCounts: Record<string, number>;
  loading: boolean;
  t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0], params?: Record<string, string | number>) => string;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; count: number; above: boolean } | null>(null);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  // Earliest year that has any data (or current year if none)
  const minYear = useMemo(() => {
    const keys = Object.keys(dailyCounts);
    if (keys.length === 0) return currentYear;
    return Math.min(...keys.map((k) => parseInt(k.slice(0, 4), 10)));
  }, [dailyCounts, currentYear]);

  const { weeks, monthLabels } = useMemo(
    () => buildHeatmapGrid(dailyCounts, year),
    [dailyCounts, year],
  );

  // Count for the selected year only
  const yearCounts = useMemo(() => {
    const prefix = String(year);
    return Object.fromEntries(Object.entries(dailyCounts).filter(([k]) => k.startsWith(prefix)));
  }, [dailyCounts, year]);

  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(yearCounts)),
    [yearCounts],
  );

  const totalDaysActive = useMemo(
    () => Object.values(yearCounts).filter((v) => v > 0).length,
    [yearCounts],
  );

  const CELL = 13;   // cell size px
  const GAP  = 2;    // gap px
  const STEP = CELL + GAP;

  return (
    <Card className="shadow-md transition-all duration-500 hover:shadow-lg overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">{t('dashboard.dailyActivity')}</CardTitle>
          {/* Year navigator — top right */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1 py-0.5">
            <button
              onClick={() => setYear((y) => Math.max(minYear, y - 1))}
              disabled={year <= minYear}
              className="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:bg-white hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-slate-700 px-1 tabular-nums">{year}</span>
            <button
              onClick={() => setYear((y) => Math.min(currentYear, y + 1))}
              disabled={year >= currentYear}
              className="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:bg-white hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
            >
              ›
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-4 pt-1">
        {loading ? (
          <div className="h-[120px] animate-pulse rounded-md bg-muted/30" />
        ) : (
          <div className="w-full overflow-x-hidden">
            {/* Positioning anchor for the tooltip */}
            <div
              className="relative overflow-hidden"
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Outer container with day-label gutter */}
              <div className="inline-flex gap-0" style={{ paddingLeft: 44 }}>
                {/* Day-of-week labels column */}
                <div
                  className="absolute left-0 top-0 flex flex-col"
                  style={{ gap: GAP, paddingTop: 20 }}
                >
                  {DAYS_SHORT.map((d, i) => (
                    <div
                      key={d}
                      className="text-[10px] text-muted-foreground text-right pr-3 leading-none"
                      style={{
                        height: CELL,
                        lineHeight: `${CELL}px`,
                        visibility: i % 2 === 0 ? 'visible' : 'hidden',
                      }}
                    >
                      {d}
                    </div>
                  ))}
                </div>

                {/* Grid */}
                <div className="flex flex-col">
                  {/* Month labels row */}
                  <div className="relative h-5" style={{ marginBottom: 2 }}>
                    {monthLabels.map(({ weekIndex, label }) => (
                      <span
                        key={`${weekIndex}-${label}`}
                        className="absolute text-[10px] text-muted-foreground"
                        style={{ left: weekIndex * STEP }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>

                  {/* Weeks × days grid */}
                  <div className="flex" style={{ gap: GAP }}>
                    {weeks.map((week, wi) => (
                      <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                        {week.map((cell, di) => (
                          <div
                            key={cell.date}
                            className={cn(
                              'rounded-sm cursor-pointer transition-all duration-100',
                              cell.isFuture ? 'opacity-0 pointer-events-none' : getCellColor(cell.count, maxCount),
                              cell.isCurrentDay && 'ring-1 ring-offset-1 ring-primary/60',
                              tooltip?.date === cell.date && 'ring-2 ring-offset-1 ring-slate-500 brightness-75',
                            )}
                            style={{ width: CELL, height: CELL }}
                            onMouseEnter={() => {
                              const x = 44 + wi * STEP + CELL / 2;
                              const y = 20 + 2 + di * STEP;
                              // If cell is in top 3 rows, show tooltip below to avoid clipping
                              setTooltip({ x, y, date: cell.date, count: cell.count, above: di >= 3 });
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tooltip — absolute within the positioning anchor */}
              {tooltip && (
                <div
                  className="absolute z-50 rounded-lg border bg-white px-3 py-2 text-xs shadow-xl pointer-events-none whitespace-nowrap"
                  style={{
                    left: tooltip.x,
                    ...(tooltip.above
                      ? { top: tooltip.y - 8, transform: 'translateX(-50%) translateY(-100%)' }
                      : { top: tooltip.y + CELL + 8, transform: 'translateX(-50%)' }),
                  }}
                >
                  <p className="font-semibold text-slate-700">
                    {tooltip.date.replace(/-/g, '.')}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    {t('dashboard.activityCount', { count: tooltip.count })}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Bottom row: active days (left) + legend (right) */}
        {!loading && (
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-muted-foreground">{t('plan.activeDaysLabel', { count: totalDaysActive })}</span>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{t('dashboard.activityMore')}</span>
              {[0, 0.2, 0.45, 0.7, 1].map((r, i) => (
                <div
                  key={i}
                  className={cn('rounded-sm', r === 0 ? 'bg-slate-100' : r < 0.3 ? 'bg-primary/25' : r < 0.55 ? 'bg-primary/55' : r < 0.85 ? 'bg-primary/80' : 'bg-primary')}
                  style={{ width: CELL, height: CELL }}
                />
              ))}
              <span>{t('dashboard.activityLess')}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Exam Date Dialog ────────────────────────────────────────────────────────

type BarTab = 'ca' | 'ny' | 'other' | 'custom';

// All US states that have bar exams (abbreviated list for select)
const US_BAR_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'GU', name: 'Guam' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
];

// ─── Shared exam-date picker (bar type + date input + mini calendar) ───────

function ExamDatePickerFields({
  value,
  examState,
  onChange,
}: {
  value: string | null; // ISO yyyy-mm-dd
  examState?: string | null;
  onChange: (iso: string, state: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<BarTab>('ca');
  const [otherState, setOtherState] = useState<string>('');
  // dateInput is in display format YYYY/MM/DD
  const [dateInput, setDateInput] = useState('');
  const [showCal, setShowCal] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // Suggested next exam date for CA/NY tabs
  const suggestedDate = useMemo((): Date | null => {
    if (tab === 'ca') return nextBarExamDate('ca');
    if (tab === 'ny') return nextBarExamDate('ny');
    return null;
  }, [tab]);

  // Initialize once from incoming value/examState
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (value) {
      setDateInput(isoToDisplay(value));
      if (examState === 'ca' || examState === 'ny') {
        setTab(examState);
      } else if (examState && examState !== 'custom') {
        setTab('other');
        setOtherState(examState);
      } else {
        setTab('custom');
      }
    } else {
      setTab('ca');
      setDateInput(formatDateDisplay(nextBarExamDate('ca')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When tab changes to ca/ny, auto-fill suggested date
  useEffect(() => {
    if (!initialized.current) return;
    if (tab === 'ca' || tab === 'ny') {
      setDateInput(formatDateDisplay(nextBarExamDate(tab)));
    }
  }, [tab]);

  // Close calendar on outside click
  useEffect(() => {
    if (!showCal) return;
    const handler = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setShowCal(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCal]);

  const isValid = isValidDisplayDate(dateInput);

  // Mini calendar state
  const today = startOfLocalDay(new Date());
  const parsedDate = isValid ? startOfLocalDay(new Date(displayToIso(dateInput) + 'T00:00:00')) : null;
  const [calYear, setCalYear] = useState(parsedDate?.getFullYear() ?? today.getFullYear());
  const [calMonth, setCalMonth] = useState(parsedDate?.getMonth() ?? today.getMonth());

  useEffect(() => {
    if (parsedDate) {
      setCalYear(parsedDate.getFullYear());
      setCalMonth(parsedDate.getMonth());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateInput]);

  // Propagate valid changes to the parent
  useEffect(() => {
    if (!initialized.current || !isValid) return;
    const savedState =
      tab === 'ca' ? 'ca' :
      tab === 'ny' ? 'ny' :
      tab === 'other' ? otherState :
      'custom';
    onChange(displayToIso(dateInput), savedState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateInput, tab, otherState, isValid]);

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDow = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
  const calDays: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (calDays.length % 7 !== 0) calDays.push(null);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function selectCalDay(day: number) {
    const d = new Date(calYear, calMonth, day);
    setDateInput(formatDateDisplay(d));
    setTab('custom');
    setShowCal(false);
  }

  function handleDateInputChange(raw: string) {
    // Auto-insert slashes
    let v = raw.replace(/[^\d/]/g, '');
    // Strip extra slashes for re-formatting
    const digits = v.replace(/\//g, '');
    if (digits.length <= 4) v = digits;
    else if (digits.length <= 6) v = `${digits.slice(0, 4)}/${digits.slice(4)}`;
    else v = `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)}`;
    setDateInput(v);
    setTab('custom');
  }

  return (
    <div className="space-y-5">
      {/* Quick-select: CA / NY buttons + other states dropdown */}
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
          {t('dashboard.examBarType')}
        </p>
        {/* Joined button group: CA | NY | Other */}
        <div className="flex w-full rounded-lg border border-slate-200 overflow-hidden divide-x divide-slate-200">
          <button
            type="button"
            onClick={() => setTab('ca')}
            className={cn(
              'flex-1 py-2.5 text-sm font-semibold transition-all duration-150',
              tab === 'ca'
                ? 'bg-slate-700 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            CA
          </button>
          <button
            type="button"
            onClick={() => setTab('ny')}
            className={cn(
              'flex-1 py-2.5 text-sm font-semibold transition-all duration-150',
              tab === 'ny'
                ? 'bg-slate-700 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            NY
          </button>
          <select
            value={tab === 'other' ? otherState : ''}
            onChange={(e) => {
              if (e.target.value) {
                setTab('other');
                setOtherState(e.target.value);
                setDateInput('');
              }
            }}
            className={cn(
              'flex-1 py-2.5 px-2 text-sm font-semibold transition-all duration-150 cursor-pointer appearance-none text-center',
              tab === 'other'
                ? 'bg-slate-700 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <option value="" disabled>{tab === 'other' && otherState ? otherState : 'Other ▾'}</option>
            {US_BAR_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Suggested date hint for CA / NY */}
      {suggestedDate && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
          <CalendarDays className="w-4 h-4 text-slate-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-700 font-medium">
              {t('dashboard.examBarNextSession', { date: formatDateDisplay(suggestedDate) })}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {tab === 'ny' ? 'New York Bar — Last Tue & Wed of Feb / Jul' : 'California Bar — Last Tue & Wed of Feb / Jul'}
            </p>
          </div>
        </div>
      )}

      {/* Date input + calendar toggle */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('dashboard.examDateInput')}</label>
        {/* Joined input + calendar button group */}
        <div className={cn(
          'flex items-stretch w-full rounded-lg border overflow-hidden transition-all',
          isValid || dateInput === '' ? 'border-slate-200' : 'border-red-300',
        )}>
          <input
            type="text"
            placeholder="YYYY/MM/DD"
            maxLength={10}
            value={dateInput}
            onChange={(e) => handleDateInputChange(e.target.value)}
            className="flex-1 px-3 py-2.5 text-sm font-mono focus:outline-none bg-white"
          />
          <button
            type="button"
            onClick={() => setShowCal((v) => !v)}
            className={cn(
              'px-3 border-l border-slate-200 transition-all shrink-0',
              showCal
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-700',
            )}
          >
            <Calendar className="w-4 h-4" />
          </button>
        </div>

        {/* Mini calendar */}
        {showCal && (
          <div
            ref={calRef}
            className="mt-2 rounded-xl border border-slate-200 shadow-lg bg-white p-3 animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Month nav */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-100 text-slate-600 transition-colors"
                onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
                  else setCalMonth((m) => m - 1);
                }}
              >
                ‹
              </button>
              <span className="text-sm font-semibold text-slate-800">
                {monthNames[calMonth]} {calYear}
              </span>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-100 text-slate-600 transition-colors"
                onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
                  else setCalMonth((m) => m + 1);
                }}
              >
                ›
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 mb-1">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                <div key={d} className="text-center text-[10px] text-muted-foreground font-medium py-0.5">{d}</div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {calDays.map((day, idx) => {
                if (day === null) return <div key={`empty-${idx}`} />;
                const thisDate = new Date(calYear, calMonth, day);
                const isToday = thisDate.toDateString() === today.toDateString();
                const isSelected = parsedDate && thisDate.toDateString() === parsedDate.toDateString();
                return (
                  <button
                    type="button"
                    key={day}
                    onClick={() => selectCalDay(day)}
                    className={cn(
                      'h-7 w-7 mx-auto rounded-full text-xs transition-all',
                      isSelected && 'bg-slate-700 text-white font-bold',
                      !isSelected && isToday && 'border border-slate-500 text-slate-700 font-semibold',
                      !isSelected && !isToday && 'text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Subject Weight Planner Dialog ──────────────────────────────────────────

type WeightSubject = { name: string; total: number; remaining: number };
type WeightSubjectStats = WeightSubject & {
  correct: number;
  incorrect: number;
  answered: number;
  averageSeconds?: number;
  riskyQuestionRatio?: number;
  masteredQuestionRatio?: number;
};

function confidenceLevelKey(value: number): 'plan.confidenceStrong' | 'plan.confidenceMedium' | 'plan.confidenceWeak' {
  if (value >= 70) return 'plan.confidenceStrong';
  if (value >= 40) return 'plan.confidenceMedium';
  return 'plan.confidenceWeak';
}

type SubjectMetricView = 'confidence' | 'accuracy' | 'stability' | 'guessRisk' | 'avgTime' | 'sampleSize';

/** Sample size needed before subject-confidence stats are considered reliable. */
const SAMPLE_SIZE_TARGET = 30;
/** Below this, an answer is likely a guess/skim rather than considered reasoning. */
const TIME_FAST_LIMIT_SECONDS = 60;
/** Above this, the answer time suggests the concept isn't yet fluent. */
const TIME_SLOW_LIMIT_SECONDS = 120;

const SUBJECT_METRIC_VIEWS: { key: SubjectMetricView; icon: typeof Gauge; labelKey: string }[] = [
  { key: 'confidence', icon: Gauge, labelKey: 'dashboard.subjectMetrics.confidence' },
  { key: 'accuracy', icon: Target, labelKey: 'dashboard.subjectMetrics.accuracy' },
  { key: 'stability', icon: Repeat2, labelKey: 'dashboard.subjectMetrics.stability' },
  { key: 'guessRisk', icon: AlertTriangle, labelKey: 'dashboard.subjectMetrics.guessRisk' },
  { key: 'avgTime', icon: Clock, labelKey: 'dashboard.subjectMetrics.avgTime' },
  { key: 'sampleSize', icon: Database, labelKey: 'dashboard.subjectMetrics.sampleSize' },
];

/**
 * Donut-style gauge for the 0-100 composite confidence score. Uses a
 * monochrome violet ramp (depth of knowledge) rather than red/amber/green so
 * it doesn't visually collide with accuracy or risk indicators.
 */
function ConfidenceGauge({ value, color, delay }: { value: number; color: string; delay: number }) {
  const radius = 40;
  const circumference = Math.PI * radius;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  
  const animatedValue = mounted ? Math.max(0, Math.min(100, value)) : 0;
  const offset = circumference * (1 - animatedValue / 100);
  
  return (
    <svg viewBox="0 0 100 52" className="h-9 w-20 shrink-0" aria-hidden="true">
      <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" strokeLinecap="round" />
      <path
        d="M 10 50 A 40 40 0 0 1 90 50"
        fill="none"
        className={cn('transition-all duration-[1200ms] ease-out', color)}
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

/** Circular progress ring with the accuracy percentage in the center. */
function AccuracyRing({ ratio, color, label, delay }: { ratio: number; color: string; label: string; delay: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const clamped = mounted ? Math.max(0, Math.min(1, ratio)) : 0;
  const dash = circumference * clamped;
  
  // Extract number from label if possible for counting animation
  const match = label.match(/(\d+)%/);
  const targetNum = match ? parseInt(match[1], 10) : null;
  const displayNum = useCountUp(mounted && targetNum !== null ? targetNum : 0, 1200);

  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 64 64" className="h-14 w-14 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={radius} fill="none"
          className={cn('transition-all duration-[1200ms] ease-out', color)}
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700 tabular-nums">
        {targetNum !== null ? `${displayNum}%` : label}
      </div>
    </div>
  );
}

/**
 * Five-segment bar for the discrete mastery/stability level.
 */
function StabilitySegments({ value, empty, delay }: { value: number; empty?: boolean; delay: number }) {
  const segments = 5;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const filled = mounted ? Math.round((Math.max(0, Math.min(100, value)) / 100) * segments) : 0;
  return (
    <div className="flex h-2 w-full gap-1">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 rounded-full transition-all duration-[800ms]',
            empty ? 'bg-slate-100' : i < filled ? 'bg-emerald-400' : 'bg-emerald-100',
          )}
          style={{ transitionDelay: mounted ? `${i * 80}ms` : '0ms' }}
        />
      ))}
    </div>
  );
}

/**
 * Color-zoned risk scale with non-linear zones.
 */
function RiskScale({ value, empty, delay }: { value: number; empty?: boolean; delay: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  if (empty) {
    return <div className="h-2 w-full rounded-full bg-slate-100" />;
  }
  
  const animatedValue = mounted ? Math.max(0, Math.min(100, value)) : 0;
  
  return (
    <div className="relative pt-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        <div className="h-full bg-green-200" style={{ width: '50%' }} />
        <div className="h-full bg-amber-200" style={{ width: '25%' }} />
        <div className="h-full bg-red-200" style={{ width: '25%' }} />
      </div>
      <div
        className="absolute top-0 h-0 w-0 border-x-[4px] border-x-transparent border-t-[5px] border-t-slate-600 transition-all duration-[1200ms] ease-out"
        style={{ left: `${animatedValue}%`, transform: 'translateX(-4px)' }}
      />
    </div>
  );
}

/**
 * Interval bullet chart for average answer time.
 */
function TimeIntervalBar({ avgSeconds, fastLimit, slowLimit, empty, delay }: { avgSeconds: number; fastLimit: number; slowLimit: number; empty?: boolean; delay: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  if (empty) {
    return <div className="h-2 w-full rounded-full bg-slate-100" />;
  }
  const scaleMax = slowLimit * 1.5;
  const targetValue = avgSeconds > 0 ? Math.min(100, (avgSeconds / scaleMax) * 100) : 0;
  const animatedValue = mounted ? targetValue : 0;
  
  const zoneColor = avgSeconds <= 0
    ? 'bg-slate-200'
    : avgSeconds < fastLimit
      ? 'bg-rose-400'
      : avgSeconds <= slowLimit
        ? 'bg-emerald-400'
        : 'bg-amber-400';
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full">
      <div className="flex h-full w-full">
        <div className="h-full bg-rose-100" style={{ width: `${(fastLimit / scaleMax) * 100}%` }} />
        <div className="h-full bg-emerald-100" style={{ width: `${((slowLimit - fastLimit) / scaleMax) * 100}%` }} />
        <div className="h-full bg-amber-100" style={{ width: `${((scaleMax - slowLimit) / scaleMax) * 100}%` }} />
      </div>
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-[1200ms] ease-out', zoneColor)}
        style={{ width: `${Math.max(animatedValue, avgSeconds > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

/**
 * "Confidence threshold" progress bar for sample size.
 */
function SampleSizeProgress({ total, target, delay }: { total: number; target: number; delay: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const done = total >= target;
  const ratio = Math.min(100, (total / target) * 100);
  const animatedRatio = mounted ? ratio : 0;
  
  return (
    <div className="flex w-full items-center gap-1.5">
      {done && <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0 text-emerald-500 transition-all duration-500 delay-[500ms]", mounted ? "opacity-100 scale-100" : "opacity-0 scale-50")} />}
      {total === 0 && <Lock className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn('h-full rounded-full transition-all duration-700', done ? 'bg-emerald-400' : 'bg-slate-400')}
          style={{ width: `${Math.max(ratio, total > 0 ? 2 : 0)}%`, transitionDelay: `${delay}ms` }}
        />
      </div>
    </div>
  );
}

function SortableSubjectItem({ id, name }: { id: string; name: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-md border bg-white px-3 py-2 text-sm text-slate-700',
        isDragging && 'opacity-50 ring-2 ring-primary ring-offset-2 z-10 relative'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab hover:text-primary hover:bg-slate-50 p-1 rounded active:cursor-grabbing text-slate-400 touch-none"
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <span className="font-medium">{name}</span>
    </div>
  );
}

function SubjectWeightPanel({
  onCancel,
  subjects,
  confidence,
  defaultConfidence,
  examDate,
  examState,
  studyDays,
  triageWeeks,
  dailyStudyHours,
  paceMode,
  subjectMode,
  subjectOrder,
  passThreshold,
  totalQuestions,
  practicedQuestions,
  saving,
  onSave,
}: {
  onCancel: () => void;
  subjects: WeightSubjectStats[];
  confidence: Record<string, number>;
  defaultConfidence: Record<string, number>;
  examDate: string | null;
  examState?: string | null;
  studyDays: number[];
  triageWeeks: number;
  dailyStudyHours: number;
  paceMode: StudyPaceMode;
  subjectMode: StudySubjectMode;
  subjectOrder?: string[];
  passThreshold: number;
  totalQuestions: number;
  practicedQuestions: number;
  saving: boolean;
  onSave: (next: { confidence: Record<string, number>; studyDays: number[]; examDate: string | null; examState: string | null; dailyStudyHours: number; paceMode: StudyPaceMode; subjectMode: StudySubjectMode; subjectOrder?: string[]; passThreshold: number }) => void;
}) {
  const { t } = useI18n();
  const dayKeys = ['plan.day.sun', 'plan.day.mon', 'plan.day.tue', 'plan.day.wed', 'plan.day.thu', 'plan.day.fri', 'plan.day.sat'] as const;

  const [tempConfidence, setTempConfidence] = useState<Record<string, number>>(confidence);
  const [tempStudyDays, setTempStudyDays] = useState<number[]>(studyDays);
  const [tempExamDate, setTempExamDate] = useState<string | null>(examDate);
  const [tempExamState, setTempExamState] = useState<string | null>(examState ?? null);
  const [tempDailyStudyHours, setTempDailyStudyHours] = useState<number>(dailyStudyHours);
  const [tempPaceMode, setTempPaceMode] = useState<StudyPaceMode>(paceMode);
  const [tempSubjectMode, setTempSubjectMode] = useState<StudySubjectMode>(subjectMode);
  const [tempSubjectOrder, setTempSubjectOrder] = useState<string[]>(
    subjectOrder?.length ? subjectOrder : subjects.map(s => s.name)
  );
  const [tempPassThreshold, setTempPassThreshold] = useState<number>(passThreshold);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setTempSubjectOrder((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const suggestedConfidence = useMemo(
    () => calculateSuggestedSubjectConfidence(subjects.map((subject) => ({
      name: subject.name,
      correct: subject.correct,
      incorrect: subject.incorrect,
      total: subject.answered,
      averageSeconds: subject.averageSeconds,
      riskyQuestionRatio: subject.riskyQuestionRatio,
      masteredQuestionRatio: subject.masteredQuestionRatio,
    }))),
    [subjects],
  );

  const quotaPreview = useMemo(
    () => calculateDailyQuota(totalQuestions, practicedQuestions, tempExamDate, tempStudyDays, triageWeeks, tempDailyStudyHours, 0, tempPaceMode),
    [totalQuestions, practicedQuestions, tempExamDate, tempStudyDays, triageWeeks, tempDailyStudyHours, tempPaceMode],
  );

  const subjectQuotas = useMemo(
    () => calculatePlannedSubjectQuotas(subjects.map((s) => ({ name: s.name, remaining: s.remaining })), quotaPreview.newQuota, tempConfidence, tempSubjectMode, quotaPreview.triageMode, tempStudyDays, new Date(), tempSubjectOrder),
    [subjects, quotaPreview.newQuota, tempConfidence, tempSubjectMode, quotaPreview.triageMode, tempStudyDays, tempSubjectOrder],
  );

  const toggleStudyDay = (day: number) => {
    setTempStudyDays((current) => (
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    ));
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left column: exam date, remaining questions, study days */}
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">{t('plan.examDateLabel')}</Label>
            <div className="mt-1.5">
              <ExamDatePickerFields
                value={tempExamDate}
                examState={tempExamState}
                onChange={(iso, state) => {
                  setTempExamDate(iso);
                  setTempExamState(state);
                }}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t('plan.remainingQuestionsInput')}</Label>
            <div className="mt-1.5 flex gap-2">
              <input
                type="number"
                value={quotaPreview.remainingQuestions}
                readOnly
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 focus:outline-none"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setTempConfidence(defaultConfidence)}
              >
                {t('plan.reset')}
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t('plan.studyDaysLabel')}</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {dayKeys.map((dayKey, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleStudyDay(idx)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    tempStudyDays.includes(idx)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50 hover:bg-primary/5',
                  )}
                >
                  {t(dayKey)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              💡 {t('plan.studyDaysSummary', { days: tempStudyDays.length, restDays: 7 - tempStudyDays.length })}
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t('plan.dailyStudyHoursLabel')}</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                value={tempDailyStudyHours}
                onChange={(e) => setTempDailyStudyHours(Math.max(0.5, Number(e.target.value) || 0.5))}
                className="w-24 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-sm text-muted-foreground">{t('plan.hoursUnit')}</span>
            </div>
            {quotaPreview.timeEstimate && (
              <p className="mt-2 text-xs text-muted-foreground">
                💡 {t('plan.timeBasedQuotaHint', {
                  min: quotaPreview.timeEstimate.min,
                  max: quotaPreview.timeEstimate.max,
                  mode: t(`plan.pace.${tempPaceMode}`),
                })}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t('plan.passThresholdLabel')}</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={tempPassThreshold}
                onChange={(e) => setTempPassThreshold(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                className="w-24 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t('plan.paceModeLabel')}</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(['leisure', 'balanced', 'intensive'] as StudyPaceMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTempPaceMode(mode)}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium transition-colors',
                    tempPaceMode === mode
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50 hover:bg-primary/5',
                  )}
                >
                  {t(`plan.pace.${mode}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t(`plan.pace.${tempPaceMode}.hint`)}</p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t('plan.subjectModeLabel')}</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['singleThenMixed', 'mixed'] as StudySubjectMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTempSubjectMode(mode)}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium transition-colors',
                    tempSubjectMode === mode
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50 hover:bg-primary/5',
                  )}
                >
                  {t(`plan.subjectMode.${mode}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t(`plan.subjectMode.${tempSubjectMode}.hint`)}</p>
            {tempSubjectMode === 'singleThenMixed' && (
              <div className="mt-4 border-t border-slate-100 pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t('plan.subjectOrderLabel')}</Label>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={tempSubjectOrder} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col gap-1.5">
                      {tempSubjectOrder.map(name => (
                        <SortableSubjectItem key={name} id={name} name={name} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <p className="mt-2 text-xs text-muted-foreground">{t('plan.subjectOrderHint')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right column: subject confidence sliders */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
          <div>
            <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              {t('plan.confidenceTitle')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{t('plan.confidenceDescription')}</p>
          </div>
          <div className="space-y-4">
            {subjects.map((subject) => {
              const value = tempConfidence[subject.name] ?? 50;
              const suggested = suggestedConfidence[subject.name] ?? 50;
              return (
                <div key={subject.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">{subject.name}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-semibold text-primary">{t('plan.confidenceLevel', { value })}</span>
                      <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                        {t(confidenceLevelKey(value))}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t('plan.confidenceSuggested', {
                      value: suggested,
                      correct: subject.correct,
                      incorrect: subject.incorrect,
                    })}
                  </p>
                  <Slider
                    className="mt-2"
                    value={[value]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={([next]) => setTempConfidence((current) => ({ ...current, [subject.name]: next }))}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Smart allocation results */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
          📊 {t('plan.allocationResultTitle')}
        </p>
        <p className="text-sm text-slate-700">
          {t('plan.allocationResultDescription', {
            days: quotaPreview.availableDays,
            studyDays: tempStudyDays.length,
            quota: quotaPreview.quota,
            newQuota: quotaPreview.newQuota,
            reviewQuota: quotaPreview.reviewQuota,
            learningDays: quotaPreview.learningDays,
            reviewDays: quotaPreview.reviewDays,
          })}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {subjects.filter((s) => s.remaining > 0).map((subject) => (
            <div key={subject.name} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs text-muted-foreground truncate">{subject.name}</p>
              <p className="text-lg font-bold text-slate-900">
                {subjectQuotas[subject.name] ?? 0} {t('plan.questionsUnit')}
              </p>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-primary text-primary-foreground p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{t('plan.todayQuotaLabel')}</p>
          <p className="text-2xl font-bold mt-1">{quotaPreview.quota} {t('plan.questionsUnit')}</p>
          <p className="text-xs opacity-80 mt-1">
            {t('plan.todayQuotaSplit', { newQuota: quotaPreview.newQuota, reviewQuota: quotaPreview.reviewQuota })}
          </p>
          {quotaPreview.timeCapped && (
            <p className="text-xs opacity-80 mt-1">{t('plan.timeCapHint')}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1 h-11 px-5 text-sm" onClick={onCancel}>
          {t('plan.cancel')}
        </Button>
        <Button
          type="button"
          className="flex-1 h-11 px-5 text-sm font-semibold"
          disabled={saving}
          onClick={() => onSave({ confidence: tempConfidence, studyDays: tempStudyDays, examDate: tempExamDate, examState: tempExamState, dailyStudyHours: tempDailyStudyHours, paceMode: tempPaceMode, subjectMode: tempSubjectMode, subjectOrder: tempSubjectOrder, passThreshold: tempPassThreshold })}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('plan.save')}
        </Button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const { t, language } = useI18n();
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyDashboardData);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [examState, setExamState] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [subjectMetricView, setSubjectMetricView] = useState<SubjectMetricView>('confidence');

  // ── Today's Mission (Smart Plan) ─────────────────────────────────────────
  const [missionSubjects, setMissionSubjects] = useState<Subject[]>([]);
  const [selectedTaskType, setSelectedTaskType] = useState<'new' | 'review' | 'incorrect'>('new');
  const [missionStatusCounts, setMissionStatusCounts] = useState<QuestionStatusCounts>(emptyQuestionStatusCounts);
  const [generatingMission, setGeneratingMission] = useState(false);
  const [showWeightDialog, setShowWeightDialog] = useState(false);
  const [savingWeights, setSavingWeights] = useState(false);

  // ── Widget visibility ────────────────────────────────────────────────────
  const [widgetVisibility, setWidgetVisibility] = useState<DashboardWidgetVisibility>(defaultDashboardWidgets);
  const [showWidgetPanel, setShowWidgetPanel] = useState(false);

  // ── Onboarding tour ───────────────────────────────────────────────────────
  const [tourOpen, setTourOpen] = useState(false);
  const tourSteps = useMemo<GuidedTourStep[]>(() => [
    {
      selector: '[data-tour="dashboard-mission"]',
      title: t('tour.dashboardMissionTitle'),
      description: t('tour.dashboardMissionDescription'),
    },
    {
      selector: '[data-tour="dashboard-review"]',
      title: t('tour.dashboardReviewTitle'),
      description: t('tour.dashboardReviewDescription'),
    },
    {
      selector: '[data-tour="dashboard-calendar"]',
      title: t('tour.dashboardCalendarTitle'),
      description: t('tour.dashboardCalendarDescription'),
    },
    {
      selector: '[data-tour="dashboard-stats"]',
      title: t('tour.dashboardStatsTitle'),
      description: t('tour.dashboardStatsDescription'),
    },
    {
      selector: '[data-tour="concept-items"]',
      title: t('tour.conceptItemsTitle'),
      description: t('tour.conceptItemsDescription'),
    },
    {
      selector: '[data-tour="create-test"]',
      title: t('tour.createTestTitle'),
      description: t('tour.createTestDescription'),
    },
    {
      selector: '[data-tour="practice-review-items"]',
      title: t('tour.practiceReviewItemsTitle'),
      description: t('tour.practiceReviewItemsDescription'),
    },
    {
      selector: '[data-tour="settings"]',
      title: t('tour.settingsTitle'),
      description: t('tour.settingsDescription'),
    },
    {
      selector: '[data-tour="profile"]',
      title: t('tour.profileTitle'),
      description: t('tour.profileDescription'),
    },
  ], [t]);

  // Auto-open the tour the first time a user reaches the dashboard
  useEffect(() => {
    if (!profile) return;
    if (dashboardData.error) return;
    if (profile.study_settings?.hasSeenDashboardTour) return;
    setTourOpen(true);
  }, [profile, dashboardData.error]);

  const closeTour = (open: boolean) => {
    setTourOpen(open);
    if (open || !user?.id) return;
    const updatedSettings = normalizeStudySettings({
      ...(profile?.study_settings ?? getStudySettings()),
      hasSeenDashboardTour: true,
    });
    saveStudySettings(updatedSettings);
    void saveUserStudySettings(user.id, updatedSettings).then(() => refreshProfile());
  };

  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (profile?.exam_date) setExamDate(profile.exam_date);
  }, [profile?.exam_date]);

  useEffect(() => {
    if (profile?.study_settings?.dashboardWidgets) {
      setWidgetVisibility({ ...defaultDashboardWidgets, ...profile.study_settings.dashboardWidgets });
    }
  }, [profile?.study_settings?.dashboardWidgets]);

  const toggleWidget = async (key: DashboardWidgetKey) => {
    const next = { ...widgetVisibility, [key]: !widgetVisibility[key] };
    setWidgetVisibility(next);
    const updatedSettings = normalizeStudySettings({
      ...(profile?.study_settings ?? getStudySettings()),
      dashboardWidgets: next,
    });
    saveStudySettings(updatedSettings);
    if (user?.id) {
      await saveUserStudySettings(user.id, updatedSettings);
      await refreshProfile();
    }
  };

  // Load exam state from DB settings first, falling back to legacy localStorage.
  useEffect(() => {
    if (!user?.id) return;
    const savedInProfile = profile?.study_settings?.studyPlan?.examState;
    if (savedInProfile) {
      setExamState(savedInProfile);
      localStorage.setItem(`passbar_exam_state_${user.id}`, savedInProfile);
      return;
    }
    const saved = localStorage.getItem(`passbar_exam_state_${user.id}`);
    if (saved) setExamState(saved);
  }, [profile?.study_settings?.studyPlan?.examState, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    let active = true;
    setDashboardData((current) => ({ ...current, loading: true, error: null }));
    loadDashboardData(user.id)
      .then((data) => {
        if (!active) return;
        setDashboardData({ ...data, loading: false });
      })
      .catch((error: Error) => {
        if (!active) return;
        console.warn('[PassBar] Failed to load dashboard data:', error.message);
        setDashboardData({ ...emptyDashboardData, loading: false, error: error.message });
      });

    return () => {
      active = false;
    };
  }, [user?.id]);


  const handleSaveExamDate = async (date: string, state: string) => {
    setExamDate(date);   // optimistic update
    setExamState(state);
    if (user?.id) {
      localStorage.setItem(`passbar_exam_state_${user.id}`, state);
    }
    if (!user?.id) return;
    try {
      await api.patch('/users/me/exam-date', { examDate: date });
      await refreshProfile();
    } catch (err) {
      console.error('[PassBar] Failed to save exam_date:', err);
      setExamDate(profile?.exam_date ?? null); // revert
    }
  };

  // ── Today's Mission (Smart Plan) ─────────────────────────────────────────
  useEffect(() => {
    getSubjects().then(setMissionSubjects);
  }, []);

  const missionTotalQuestions = useMemo(
    () => missionSubjects.reduce((sum, s) => sum + s.count, 0),
    [missionSubjects],
  );

  useEffect(() => {
    if (!user?.id || missionTotalQuestions === 0) return;
    getQuestionStatusCounts(user.id, missionTotalQuestions).then(setMissionStatusCounts);
  }, [user?.id, missionTotalQuestions]);

  const missionPracticedQuestions = missionStatusCounts.Correct + missionStatusCounts.Incorrect;
  const rawStudyDays = profile?.study_settings?.studyPlan?.studyDaysPerWeek;
  // fallback 陣列包進 useMemo，避免每次 render 產生新 identity 導致下游 useMemo 全部失效
  const studyDays = useMemo(
    () => (Array.isArray(rawStudyDays) && rawStudyDays.length > 0 ? rawStudyDays : [1, 2, 3, 4, 5]),
    [rawStudyDays],
  );
  const triageWeeks = profile?.study_settings?.studyPlan?.triageWeeks ?? 2;
  const dailyStudyHours = profile?.study_settings?.studyPlan?.dailyStudyHours ?? 3;
  const paceMode = profile?.study_settings?.studyPlan?.paceMode ?? 'balanced';
  const subjectMode = profile?.study_settings?.studyPlan?.subjectMode ?? 'singleThenMixed';
  const subjectOrder = profile?.study_settings?.studyPlan?.subjectOrder;

  const subjectsWithRemaining = useMemo(
    () => missionSubjects.map((subject) => {
      const performance = dashboardData.subjectPerformance.find((p) => p.name === subject.name);
      const answered = performance?.total ?? 0;
      const chapterStats = dashboardData.chapterStats.filter((chapter) => chapter.subject === subject.name);
      const timedAttempts = chapterStats.reduce((sum, chapter) => sum + (chapter.timedAttempts ?? 0), 0);
      const totalTimeSeconds = chapterStats.reduce((sum, chapter) => sum + (chapter.totalTimeSeconds ?? 0), 0);
      const assessedQuestions = chapterStats.reduce((sum, chapter) => sum + (chapter.questionCount ?? 0), 0);
      const riskyQuestions = chapterStats.reduce((sum, chapter) => sum + (chapter.riskyQuestionCount ?? 0), 0);
      const masteredQuestions = chapterStats.reduce((sum, chapter) => sum + (chapter.masteredQuestionCount ?? 0), 0);
      return {
        name: subject.name,
        total: subject.count,
        remaining: Math.max(0, subject.count - answered),
        correct: performance?.correct ?? 0,
        incorrect: Math.max(0, answered - (performance?.correct ?? 0)),
        answered,
        averageSeconds: timedAttempts > 0 ? totalTimeSeconds / timedAttempts : 0,
        riskyQuestionRatio: assessedQuestions > 0 ? riskyQuestions / assessedQuestions : 0,
        masteredQuestionRatio: assessedQuestions > 0 ? masteredQuestions / assessedQuestions : 0,
      };
    }),
    [missionSubjects, dashboardData.subjectPerformance, dashboardData.chapterStats],
  );

  const subjectMetricsByName = useMemo(
    () => new Map(subjectsWithRemaining.map((subject) => [subject.name, subject])),
    [subjectsWithRemaining],
  );

  const dueReviewChapters = useMemo(
    () => getDueReviewChapters(dashboardData.chapterStats),
    [dashboardData.chapterStats],
  );

  const quotaInfo = useMemo(
    () => calculateDailyQuota(missionTotalQuestions, missionPracticedQuestions, examDate, studyDays, triageWeeks, dailyStudyHours, dueReviewChapters.length, paceMode),
    [missionTotalQuestions, missionPracticedQuestions, examDate, studyDays, triageWeeks, dailyStudyHours, dueReviewChapters.length, paceMode],
  );

  const defaultConfidence = useMemo(() => {
    return calculateSuggestedSubjectConfidence(subjectsWithRemaining.map((subject) => ({
      name: subject.name,
      correct: subject.correct,
      incorrect: subject.incorrect,
      total: subject.answered,
      averageSeconds: subject.averageSeconds,
      riskyQuestionRatio: subject.riskyQuestionRatio,
      masteredQuestionRatio: subject.masteredQuestionRatio,
    })));
  }, [subjectsWithRemaining]);

  const savedConfidence = profile?.study_settings?.studyPlan?.subjectConfidence;

  const subjectConfidence = useMemo(
    () => ({ ...defaultConfidence, ...(savedConfidence ?? {}) }),
    [defaultConfidence, savedConfidence],
  );

  const reviewSplit = useMemo(
    () => splitQuotaForReview(quotaInfo.quota, dueReviewChapters.length, quotaInfo.reviewQuota),
    [quotaInfo.quota, quotaInfo.reviewQuota, dueReviewChapters.length],
  );

  const subjectQuotas = useMemo(
    () => calculatePlannedSubjectQuotas(subjectsWithRemaining, reviewSplit.newQuota, subjectConfidence, subjectMode, quotaInfo.triageMode, studyDays, new Date(), subjectOrder),
    [subjectsWithRemaining, reviewSplit.newQuota, subjectConfidence, subjectMode, quotaInfo.triageMode, studyDays, subjectOrder],
  );

  const plannedNewChapterIds = useMemo(
    () => getPlannedChapterIdsForDate(missionSubjects, subjectQuotas, subjectMode, quotaInfo.triageMode, studyDays),
    [missionSubjects, subjectQuotas, subjectMode, quotaInfo.triageMode, studyDays],
  );

  const handleStartMission = async (taskType: 'new' | 'review' | 'incorrect') => {
    if (!user) return;
    setGeneratingMission(true);
    
    if (taskType === 'incorrect') {
      const result = await generateIncorrectSession(user.id, Math.max(20, reviewSplit.reviewQuota));
      if (result) {
        router.push(`/test?id=${encodeURIComponent(result.session.id)}`);
      } else {
        setGeneratingMission(false);
        alert(t('plan.noQuestionsAlert'));
      }
      return;
    }

    let targetQuota = quotaInfo.quota;
    let reviewQuota = reviewSplit.reviewQuota;
    let reviewChapterIds = dueReviewChapters.map((c) => c.chapterId);

    if (taskType === 'new') {
      targetQuota = reviewSplit.newQuota;
      reviewQuota = 0;
      reviewChapterIds = [];
    } else if (taskType === 'review') {
      targetQuota = reviewSplit.reviewQuota;
      reviewQuota = reviewSplit.reviewQuota;
    }

    const result = await generateTodayMissionSession(
      user.id,
      targetQuota,
      quotaInfo.triageMode,
      subjectQuotas,
      reviewChapterIds,
      reviewQuota,
      plannedNewChapterIds,
    );
    if (result) {
      router.push(`/test?id=${encodeURIComponent(result.session.id)}`);
    } else {
      setGeneratingMission(false);
      alert(t('plan.noQuestionsAlert'));
    }
  };

  const handleSaveWeights = async (next: { confidence: Record<string, number>; studyDays: number[]; examDate: string | null; examState: string | null; dailyStudyHours: number; paceMode: StudyPaceMode; subjectMode: StudySubjectMode; subjectOrder?: string[]; passThreshold: number }) => {
    if (!user || !profile) return;
    setSavingWeights(true);
    const updatedSettings = {
      ...(profile.study_settings ?? getStudySettings()),
      studyPlan: {
        ...(profile.study_settings?.studyPlan ?? {}),
        examState: next.examState,
        studyDaysPerWeek: next.studyDays,
        triageWeeks,
        subjectConfidence: next.confidence,
        dailyStudyHours: next.dailyStudyHours,
        paceMode: next.paceMode,
        subjectMode: next.subjectMode,
        subjectOrder: next.subjectOrder,
        passThreshold: next.passThreshold,
      },
    };
    saveStudySettings(updatedSettings);
    await saveUserStudySettings(user.id, updatedSettings);
    if (next.examState !== examState) {
      setExamState(next.examState);
      localStorage.setItem(`passbar_exam_state_${user.id}`, next.examState ?? 'custom');
    }
    if (next.examDate && (next.examDate !== examDate || next.examState !== examState)) {
      await handleSaveExamDate(next.examDate, next.examState ?? 'custom');
    }
    await refreshProfile();
    setSavingWeights(false);
    setShowWeightDialog(false);
  };

  const strongestSubject = useMemo(
    () => dashboardData.subjectPerformance
      .filter((subject) => subject.total > 0)
      .sort((a, b) => b.score - a.score)[0],
    [dashboardData.subjectPerformance],
  );

  const weakestSubject = useMemo(
    () => dashboardData.subjectPerformance
      .filter((subject) => subject.total > 0)
      .sort((a, b) => a.score - b.score)[0],
    [dashboardData.subjectPerformance],
  );

  const weakFocusSubjects = useMemo(
    () => dashboardData.subjectPerformance
      .filter((subject) => subject.total > 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 2)
      .map((subject) => subject.name),
    [dashboardData.subjectPerformance],
  );



  // Each slide is a compact metric card; 2 are grouped per carousel page
  type InsightCard = { id: string; icon: React.ReactNode; label: string; value: React.ReactNode; sub: React.ReactNode; color: string; href?: string };

  const insightCards = useMemo<InsightCard[]>(() => {
    const cards: InsightCard[] = [];

    // Card 1: strongest subject
    if (strongestSubject) {
      cards.push({
        id: 'strong',
        icon: <TrendingUp className="w-4 h-4" />,
        label: t('dashboard.strongInsightLabel'),
        value: <span className="text-lg font-bold text-green-900 leading-tight">{strongestSubject.name}</span>,
        sub: <span>{t('dashboard.strongInsightDescription', { score: strongestSubject.score, total: strongestSubject.total })}</span>,
        color: 'bg-green-50 border-green-100 text-green-600',
      });
    }

    // Card 2: weakest subject → link to create
    if (weakestSubject && weakestSubject.name !== strongestSubject?.name) {
      cards.push({
        id: 'weak',
        icon: <Target className="w-4 h-4" />,
        label: t('dashboard.focusLabel'),
        value: <span className="text-lg font-bold text-red-900 leading-tight">{weakestSubject.name}</span>,
        sub: <span>{weakestSubject.score}% · {t('dashboard.focusCTA')} →</span>,
        color: 'bg-red-50 border-red-100 text-red-500',
        href: '/create',
      });
    }

    // Card 3: today's progress
    cards.push({
      id: 'today',
      icon: <Clock className="w-4 h-4" />,
      label: t('dashboard.todayProgress'),
      value: (
        <span className="text-2xl font-bold text-secondary leading-none">{dashboardData.solvedToday}
          <span className="text-sm font-normal text-muted-foreground ml-1">{t('dashboard.questionsUnit')}</span>
        </span>
      ),
      sub: <span>⏱ {formatDuration(dashboardData.timeTodaySeconds, t)}</span>,
      color: 'bg-primary/5 border-primary/20 text-primary',
    });

    // Card 4: overall mastery
    cards.push({
      id: 'mastery',
      icon: <Trophy className="w-4 h-4" />,
      label: t('dashboard.masteryLabel'),
      value: <span className="text-2xl font-bold text-primary leading-none">{Math.round(dashboardData.mastery)}%</span>,
      sub: <span>{dashboardData.solvedQuestions.toLocaleString()} / {dashboardData.totalQuestions.toLocaleString()} {t('dashboard.masteryOverall')}</span>,
      color: 'bg-slate-50 border-slate-200 text-slate-500',
    });

    // Card 5: recent accuracy trend (last 7 days)
    if (dashboardData.recentAccuracy !== null) {
      const overallAccuracy = Math.round(dashboardData.mastery);
      const diff = dashboardData.recentAccuracy - overallAccuracy;
      const up = diff >= 0;
      cards.push({
        id: 'recent-accuracy',
        icon: <TrendingUp className={cn('w-4 h-4', !up && 'rotate-180')} />,
        label: t('dashboard.recentAccuracyLabel'),
        value: (
          <span className={cn('text-2xl font-bold leading-none', up ? 'text-green-900' : 'text-orange-800')}>
            {dashboardData.recentAccuracy}%
            <span className={cn('text-xs font-semibold ml-1.5', up ? 'text-green-600' : 'text-orange-500')}>
              {diff >= 0 ? '+' : ''}{diff}%
            </span>
          </span>
        ),
        sub: <span>{t('dashboard.recentAccuracyDescription', { overall: overallAccuracy })}</span>,
        color: up ? 'bg-green-50 border-green-100 text-green-600' : 'bg-orange-50 border-orange-100 text-orange-500',
      });
    }

    // Card 6: incorrect count (review reminder)
    if (dashboardData.incorrectCount > 0) {
      cards.push({
        id: 'incorrect',
        icon: <BookOpen className="w-4 h-4" />,
        label: t('dashboard.incorrectLabel'),
        value: <span className="text-2xl font-bold text-rose-900 leading-none">{dashboardData.incorrectCount.toLocaleString()}</span>,
        sub: <span>{t('dashboard.incorrectCTA')} →</span>,
        color: 'bg-rose-50 border-rose-100 text-rose-500',
        href: '/review',
      });
    }

    // Card 7: weekly study time
    cards.push({
      id: 'weekly-time',
      icon: <Clock className="w-4 h-4" />,
      label: t('dashboard.weeklyTimeLabel'),
      value: <span className="text-2xl font-bold text-indigo-900 leading-none">{formatDuration(Math.round(dashboardData.weeklyStudyTimeSeconds), t)}</span>,
      sub: <span>{t('dashboard.weeklyTimeDescription')}</span>,
      color: 'bg-indigo-50 border-indigo-100 text-indigo-500',
    });

    // Card 8: best streak ever
    cards.push({
      id: 'best-streak',
      icon: <Flame className="w-4 h-4" />,
      label: t('dashboard.bestStreakLabel'),
      value: (
        <span className="text-2xl font-bold text-amber-900 leading-none">{dashboardData.bestStreak}
          <span className="text-sm font-normal text-amber-700 ml-1">{t('dashboard.bestStreakUnit')}</span>
        </span>
      ),
      sub: <span>
        {dashboardData.streakDays >= dashboardData.bestStreak && dashboardData.bestStreak > 0
          ? t('dashboard.bestStreakCurrent')
          : t('dashboard.bestStreakDescription', { current: dashboardData.streakDays })}
      </span>,
      color: 'bg-amber-50 border-amber-100 text-amber-600',
    });

    return cards;
  }, [strongestSubject, weakestSubject, dashboardData, t]);



  const userFirstName = displayNameFromProfile(profile?.full_name, profile?.email ?? user?.email);
  const remainingQuestions = Math.max(dashboardData.totalQuestions - dashboardData.solvedQuestions, 0);

  const SAFE_PASS_THRESHOLD = profile?.study_settings?.studyPlan?.passThreshold ?? 75;
  const completionRate = dashboardData.totalQuestions > 0
    ? (dashboardData.solvedQuestions / dashboardData.totalQuestions) * 100
    : 0;
  const streakBadgeMilestones: Array<{ days: number; key: any }> = [
    { days: 7, key: 'badge.discipline.title' },
    { days: 30, key: 'badge.consistency.title' },
    { days: 100, key: 'dashboard.badge.master' },
  ];
  const nextStreakBadge = streakBadgeMilestones.find((m) => dashboardData.streakDays < m.days);
  const estimatedRemainingHours = Math.round(
    (remainingQuestions * (dashboardData.avgSecondsPerQuestion || 90)) / 3600,
  );

  const masteryDisplay = useCountUp(Math.round(dashboardData.loading ? 0 : dashboardData.mastery));
  const todayDisplay = startOfLocalDay(new Date()).toISOString().slice(0, 10);

  const isNewCompleted = reviewSplit.newQuota > 0 && dashboardData.solvedToday >= reviewSplit.newQuota;
  const isReviewCompleted = dashboardData.solvedQuestions > 0 && dueReviewChapters.length === 0;
  const isIncorrectCompleted = dashboardData.solvedQuestions > 0 && dashboardData.incorrectCount === 0;

  // Ensure valid selection if default is completed
  useEffect(() => {
    if (selectedTaskType === 'new' && isNewCompleted) {
      if (!isReviewCompleted) setSelectedTaskType('review');
      else if (!isIncorrectCompleted) setSelectedTaskType('incorrect');
    } else if (selectedTaskType === 'review' && isReviewCompleted) {
      if (!isNewCompleted) setSelectedTaskType('new');
      else if (!isIncorrectCompleted) setSelectedTaskType('incorrect');
    } else if (selectedTaskType === 'incorrect' && isIncorrectCompleted) {
      if (!isNewCompleted) setSelectedTaskType('new');
      else if (!isReviewCompleted) setSelectedTaskType('review');
    }
  }, [isNewCompleted, isReviewCompleted, isIncorrectCompleted, selectedTaskType]);

  if (dashboardData.error) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
        <Database className="mx-auto h-16 w-16 text-slate-300 mb-6" />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">{t('dashboard.maintenanceTitle')}</h2>
        <p className="text-slate-500 max-w-md mx-auto mb-6">
          {t('dashboard.maintenanceDescription')}
        </p>
        <Button onClick={() => window.location.reload()} variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          {t('dashboard.refreshPage')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          'space-y-8 transition-all duration-700 -mt-2 md:-mt-4',
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        )}
      >
        <div className="flex flex-col gap-3 md:gap-4">
          <div className="hidden md:flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs font-medium text-slate-600 border-slate-300 bg-white hover:bg-slate-50"
              onClick={() => setTourOpen(true)}
            >
              {t('dashboard.launchTutorial')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs font-medium text-slate-600 border-slate-300 bg-white hover:bg-slate-50 gap-1"
              onClick={() => setShowWidgetPanel((v) => !v)}
            >
              {t('dashboard.customizeWidgets')}
              {showWidgetPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>

          <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-5 xl:gap-4">
            {/* Left: title + badge */}
            <div className="space-y-2.5 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-tight">
                {t('dashboard.welcomePrefix')}{' '}
                <span className="bg-gradient-to-r from-primary/50 to-primary bg-clip-text text-transparent">
                  {userFirstName}
                </span>
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <ExamCountdownBadge
                  examDate={examDate}
                  examState={examState}
                  onSetDate={() => setShowWeightDialog(true)}
                />
              </div>
            </div>
          </header>
        </div>

        {/* Widget visibility panel */}
        {showWidgetPanel && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
            <p className="text-sm font-bold text-slate-800">{t('dashboard.customizeWidgets')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(Object.keys(widgetVisibility) as DashboardWidgetKey[]).map((key) => (
                <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="text-sm text-slate-700">{t(`dashboard.widgets.${key}` as Parameters<typeof t>[0])}</span>
                  <Switch checked={widgetVisibility[key]} onCheckedChange={() => toggleWidget(key)} />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Today's Mission (Smart Plan) */}
        {widgetVisibility.todaysMission && (
        <Card data-tour="dashboard-mission" className="hover:shadow-md transition-shadow mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                {showWeightDialog ? (
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                ) : (
                  <Flag className="h-4 w-4 text-primary" />
                )}
                {showWeightDialog ? t('plan.weightPlannerTitle') : t('plan.todaysMission')}
              </CardTitle>
              {showWeightDialog ? (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={() => setShowWeightDialog(false)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              ) : examDate ? (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={() => setShowWeightDialog(true)}>
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-6 pt-2">
            {showWeightDialog ? (
              <SubjectWeightPanel
                onCancel={() => setShowWeightDialog(false)}
                subjects={subjectsWithRemaining}
                confidence={subjectConfidence}
                defaultConfidence={defaultConfidence}
                examDate={examDate}
                examState={examState}
                studyDays={studyDays}
                triageWeeks={triageWeeks}
                dailyStudyHours={dailyStudyHours}
                paceMode={paceMode}
                subjectMode={subjectMode}
                subjectOrder={profile?.study_settings?.studyPlan?.subjectOrder}
                passThreshold={SAFE_PASS_THRESHOLD}
                totalQuestions={missionTotalQuestions}
                practicedQuestions={missionPracticedQuestions}
                saving={savingWeights}
                onSave={handleSaveWeights}
              />
            ) : !examDate ? (
              <div className="flex flex-col items-center text-center gap-2 py-4">
                <p className="text-sm text-slate-700">{t('plan.examDateHint')}</p>
                <Button variant="outline" size="sm" className="h-11 px-5 text-sm" onClick={() => setShowWeightDialog(true)}>
                  {t('dashboard.setExamDate')}
                </Button>
              </div>
            ) : (
              <>
                {quotaInfo.quota > 0 ? (
                  <div className="flex flex-col xl:flex-row items-stretch gap-6 xl:gap-8 pb-6 border-b border-slate-100">
                    
                    {/* Left: Goals & Progress */}
                    <div className="flex-1 w-full flex flex-col justify-center space-y-4">
                      <div>

                        <div className="flex items-baseline gap-3">
                          <span className="text-5xl font-black text-slate-800 tracking-tight"><AnimatedNumber value={quotaInfo.quota} /></span>
                          <span className="text-xl font-bold text-slate-500">{t('plan.dailyTargetLabel')}</span>
                        </div>
                      </div>

                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between text-sm font-bold">
                          <div className="flex items-center gap-1.5 text-emerald-600">
                            <BookOpen className="w-4 h-4" /> {t('plan.newQuotaLabel', { count: reviewSplit.newQuota })}
                          </div>
                          <div className="flex items-center gap-1.5 text-orange-500">
                            <RotateCcw className="w-4 h-4" /> {t('plan.reviewQuotaLabel', { count: reviewSplit.reviewQuota })}
                          </div>
                        </div>
                        <div className="h-2.5 w-full flex rounded-full overflow-hidden bg-slate-100">
                          <div className="bg-emerald-500 h-full transition-all duration-1000" style={{ width: `${(reviewSplit.newQuota / Math.max(1, quotaInfo.quota)) * 100}%` }}></div>
                          <div className="bg-orange-400 h-full transition-all duration-1000" style={{ width: `${(reviewSplit.reviewQuota / Math.max(1, quotaInfo.quota)) * 100}%` }}></div>
                        </div>
                      </div>
                    </div>

                    {/* Right: AI Recommendations */}
                    <div className="flex-1 w-full bg-[#fcfbfa] rounded-xl p-5 border border-[#f0eee9] flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 font-bold text-slate-800 mb-4">
                          <Cpu className="w-5 h-5 text-[#c29d4c]" /> {t('plan.aiRecommendedSubjects')}
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                          {weakFocusSubjects.length > 0 ? (
                            weakFocusSubjects.map((subj, i) => (
                              <span key={subj} className="px-3.5 py-1.5 bg-white border border-[#f0eee9] rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm" style={{ color: i % 2 === 0 ? '#b91c1c' : '#b45309' }}>
                                <span className={`w-2 h-2 rounded-full ${i % 2 === 0 ? 'bg-red-500' : 'bg-orange-500'}`}></span> {subj}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-500 font-medium">{t('plan.aiBalanced')}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        className="w-full h-12 bg-[#c29d4c] hover:bg-[#b08d44] text-white font-bold text-base rounded-xl shadow-md transition-all active:scale-[0.98]"
                        onClick={() => handleStartMission('new')}
                        disabled={generatingMission}
                      >
                        {generatingMission ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                        {t('plan.startPractice', { count: quotaInfo.quota })} <ArrowRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-green-700 text-center py-8 border-b border-slate-100">
                    <CheckCircle2 className="mx-auto h-12 w-12 mb-3 opacity-80" />
                    <p className="text-lg font-semibold">{t('plan.allDoneTitle')}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t('plan.allDoneDescription')}</p>
                  </div>
                )}

                {/* Bottom 4 Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 pt-4">
                  {/* Card 1: Remaining Questions */}
                  <div className="bg-[#faf8f2] border border-[#f0eee9] rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-[88px]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#8c6d23] opacity-80 mb-1">
                      <Layers className="w-4 h-4" /> {t('plan.remainingQuestions')}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-slate-800"><AnimatedNumber value={quotaInfo.remainingQuestions} /></span>
                      <span className="text-sm font-bold text-slate-400">{t('plan.questionsUnitLabel')}</span>
                    </div>
                  </div>

                  {/* Card 2: Available Study Days */}
                  <div className="bg-[#faf8f2] border border-[#f0eee9] rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-[88px]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#8c6d23] opacity-80 mb-1">
                      <CalendarDays className="w-4 h-4" /> {t('plan.availableStudyDays')}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-slate-800"><AnimatedNumber value={quotaInfo.availableDays} /></span>
                      <span className="text-sm font-bold text-slate-400">{t('plan.daysUnitLabel')}</span>
                    </div>
                  </div>

                  {/* Card 3: Weekly Sprint */}
                  <div className="bg-[#faf8f2] border border-[#f0eee9] rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-[88px]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#8c6d23] opacity-80 mb-1">
                      <Activity className="w-4 h-4" /> {t('plan.weeklySprintLabel')}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-slate-800"><AnimatedNumber value={studyDays.length} /></span>
                      <span className="text-sm font-bold text-slate-400">{t('plan.daysUnitLabel')}</span>
                    </div>
                  </div>

                  {/* Card 4: Estimated Time */}
                  <div className="bg-[#faf8f2] border border-[#f0eee9] rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-[88px]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#8c6d23] opacity-80 mb-1">
                      <Clock className="w-4 h-4" /> {t('plan.estimatedTimeLabel')}
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black text-[#c29d4c]">
                        <AnimatedNumber value={Math.floor(quotaInfo.remainingQuestions * (dashboardData.avgSecondsPerQuestion || 90) / 3600)} />
                      </span>
                      <span className="text-sm font-bold text-[#c29d4c] opacity-80">h</span>
                      <span className="text-2xl font-black text-[#c29d4c] ml-1">
                        <AnimatedNumber value={Math.round((quotaInfo.remainingQuestions * (dashboardData.avgSecondsPerQuestion || 90) % 3600) / 60)} />
                      </span>
                      <span className="text-sm font-bold text-[#c29d4c] opacity-80">m</span>
                    </div>
                  </div>
                </div>

              </>
            )}
          </CardContent>
        </Card>
        )}

        {/* Spaced Review (Ebbinghaus forgetting curve) */}
        {widgetVisibility.spacedReview && (
        <Card data-tour="dashboard-review" className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              {t('dashboard.spacedReview.title')}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">{t('dashboard.spacedReview.description')}</p>
          </CardHeader>
          <CardContent>
            {dueReviewChapters.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">{t('dashboard.spacedReview.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {dueReviewChapters.slice(0, 5).map((chapter) => (
                  <li
                    key={chapter.chapterId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {localizeLabel(chapter.subject, language, SUBJECT_ZH)} · {localizeLabel(chapter.chapterName, language, CHAPTER_ZH)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('dashboard.spacedReview.itemMeta', { days: chapter.daysSinceLastAttempt, pct: chapter.accuracy })}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md border bg-amber-100 text-amber-700 border-amber-200 px-2 py-0.5 text-xs font-medium">
                      {t('dashboard.spacedReview.dueBadge')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        )}

        {/* Smart Study Calendar */}
        {widgetVisibility.smartCalendar && (
          <div data-tour="dashboard-calendar">
          <SmartStudyCalendar
            examDate={examDate}
            studyDays={studyDays}
            dailyQuota={quotaInfo.quota}
            dailyNewQuota={reviewSplit.newQuota}
            dailyReviewQuota={reviewSplit.reviewQuota}
            remainingQuestions={quotaInfo.remainingQuestions}
            triageWeeks={triageWeeks}
            subjectMode={subjectMode}
            subjectOrder={subjectOrder}
            subjectQuotas={subjectQuotas}
            subjects={missionSubjects}
            subjectsWithRemaining={subjectsWithRemaining}
            subjectConfidence={subjectConfidence}
            dueReviewChapters={dueReviewChapters}
            dailyChapterCounts={dashboardData.dailyChapterCounts}
            onStartToday={() => handleStartMission(selectedTaskType)}
            startingMission={generatingMission}
          />
          </div>
        )}

        {/* (Database error rendering is now handled globally above) */}

        <div data-tour="dashboard-stats" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {widgetVisibility.kpiMastery && (
          <Card
            className="bg-white/50 border-primary/10 shadow-sm transition-all duration-500 hover:shadow-md"
            style={{ transitionDelay: '0ms' }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.overallMastery')}</p>
                  <h3 className="text-2xl font-bold mt-1">
                    {dashboardData.loading ? '—' : `${masteryDisplay}%`}
                  </h3>
                </div>
                <div className="p-2 bg-primary/10 rounded-full">
                  <Trophy className="w-5 h-5 text-primary" />
                </div>
              </div>
              <Progress value={dashboardData.loading ? 0 : dashboardData.mastery} className="h-1.5 mt-4 transition-all duration-700" />
              <p className="text-xs text-muted-foreground mt-2">
                {t('dashboard.targetAccuracy', { target: SAFE_PASS_THRESHOLD })}
              </p>
            </CardContent>
          </Card>
          )}

          {widgetVisibility.kpiSolved && (
          <Card
            className="bg-white/50 border-secondary/10 shadow-sm transition-all duration-500 hover:shadow-md"
            style={{ transitionDelay: '60ms' }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.questionsSolved')}</p>
                  <h3 className="text-2xl font-bold mt-1">
                    {dashboardData.loading ? '—' : (
                      <>
                        <AnimatedNumber value={dashboardData.solvedQuestions} /> / <AnimatedNumber value={dashboardData.totalQuestions} />
                      </>
                    )}
                  </h3>
                </div>
                <div className="p-2 bg-secondary/10 rounded-full">
                  <Target className="w-5 h-5 text-secondary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-green-500" />
                <span className="text-green-500 font-semibold">+{dashboardData.solvedToday}</span> {t('dashboard.today')}
                <span className="ml-2">{t('dashboard.practiceAttempts', { count: dashboardData.practiceAttempts.toLocaleString() })}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('dashboard.completionRate', { rate: completionRate.toFixed(1) })}
              </p>
            </CardContent>
          </Card>
          )}

          {widgetVisibility.kpiStreak && (
          <Card
            className="bg-white/50 border-primary/20 shadow-sm transition-all duration-500 hover:shadow-md"
            style={{ transitionDelay: '120ms' }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.studyStreak')}</p>
                  <h3 className="text-2xl font-bold mt-1">
                    {dashboardData.loading ? '—' : <><AnimatedNumber value={dashboardData.streakDays} /> {t('dashboard.days')}</>}
                  </h3>
                </div>
                <div className="p-2 bg-primary/10 rounded-full">
                  <Flame className="w-5 h-5 text-primary" />
                </div>
              </div>
              <div className="flex gap-1 mt-4">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <div
                    key={day}
                    className={cn(
                      'flex-1 h-1.5 rounded-full transition-all duration-500',
                      day <= dashboardData.streakDays ? 'bg-primary' : 'bg-muted',
                    )}
                    style={{ transitionDelay: `${day * 60}ms` }}
                  />
                ))}
              </div>
              {nextStreakBadge && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t('badge.discipline.hint', {
                    days: nextStreakBadge.days - dashboardData.streakDays,
                    badge: t(nextStreakBadge.key),
                  })}
                </p>
              )}
              <Link href="/profile" className="inline-block mt-3 text-xs font-semibold text-primary hover:underline">
                View all achievements ➔
              </Link>
            </CardContent>
          </Card>
          )}

          {widgetVisibility.kpiTime && (
          <Card
            className="bg-white/50 border-secondary/10 shadow-sm transition-all duration-500 hover:shadow-md"
            style={{ transitionDelay: '180ms' }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.timeToday')}</p>
                  <h3 className="text-2xl font-bold mt-1">{dashboardData.loading ? '—' : formatDuration(dashboardData.timeTodaySeconds, t)}</h3>
                </div>
                <div className="p-2 bg-secondary/10 rounded-full">
                  <Clock className="w-5 h-5 text-secondary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                {t('dashboard.estimatedRemainingTime', { count: remainingQuestions.toLocaleString(), hours: estimatedRemainingHours })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t('dashboard.breakReminder')}</p>
            </CardContent>
          </Card>
          )}

        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {widgetVisibility.subjectPerformance && (
          <Card className="xl:col-span-2 shadow-md transition-all duration-700 hover:shadow-lg" style={{ transitionDelay: '300ms' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">{t('dashboard.subjectPerformance')}</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{t('dashboard.subjectPerformanceDescription')}</p>
              <div className="flex items-center gap-1.5 mt-2">
                {SUBJECT_METRIC_VIEWS.map((view) => {
                  const ViewIcon = view.icon;
                  const active = subjectMetricView === view.key;
                  return (
                    <div key={view.key} className="relative group">
                      <button
                        type="button"
                        onClick={() => setSubjectMetricView(view.key)}
                        aria-label={t(view.labelKey)}
                        aria-pressed={active}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-primary/50 hover:bg-primary/5',
                        )}
                      >
                        <ViewIcon className="h-3.5 w-3.5" />
                      </button>
                      <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                        {t(view.labelKey)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent>
              {dashboardData.subjectPerformance.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {dashboardData.subjectPerformance
                    .slice()
                    .sort((a, b) => (subjectConfidence[b.name] ?? 50) - (subjectConfidence[a.name] ?? 50))
                    .map((entry, index) => {
                      const hasAnswers = entry.total > 0;
                      const metrics = subjectMetricsByName.get(entry.name);
                      const stabilityRatio = metrics?.masteredQuestionRatio ?? 0;
                      const riskRatio = metrics?.riskyQuestionRatio ?? 0;
                      const avgSeconds = metrics?.averageSeconds ?? 0;
                      const confidence = subjectConfidence[entry.name] ?? 50;

                      let value: number | null;
                      let display: string;
                      let textColor: string;
                      let chartColor: string;
                      let level: string | null = null;

                      switch (subjectMetricView) {
                        case 'accuracy':
                          value = hasAnswers ? entry.score : null;
                          display = hasAnswers ? `${entry.score}%` : t('dashboard.subjectMetrics.noData');
                          textColor = hasAnswers ? 'text-sky-600' : 'text-slate-400';
                          chartColor = 'text-sky-400';
                          break;
                        case 'stability':
                          value = hasAnswers ? Math.round(stabilityRatio * 100) : null;
                          display = hasAnswers ? `${Math.round(stabilityRatio * 100)}%` : t('dashboard.subjectMetrics.noData');
                          textColor = 'text-emerald-600';
                          chartColor = 'bg-emerald-400';
                          break;
                        case 'guessRisk':
                          value = hasAnswers ? Math.round(riskRatio * 100) : null;
                          display = hasAnswers ? `${Math.round(riskRatio * 100)}%` : t('dashboard.subjectMetrics.noData');
                          textColor = value === null ? 'text-slate-500' : value < 50 ? 'text-emerald-600' : value < 75 ? 'text-amber-600' : 'text-red-600';
                          chartColor = 'bg-rose-400';
                          break;
                        case 'avgTime':
                          value = avgSeconds;
                          display = avgSeconds > 0
                            ? t('dashboard.subjectMetrics.seconds', { value: Math.round(avgSeconds) })
                            : t('dashboard.subjectMetrics.noData');
                          textColor = avgSeconds <= 0
                            ? 'text-slate-500'
                            : avgSeconds < TIME_FAST_LIMIT_SECONDS
                              ? 'text-rose-600'
                              : avgSeconds <= TIME_SLOW_LIMIT_SECONDS
                                ? 'text-emerald-600'
                                : 'text-amber-600';
                          chartColor = 'bg-emerald-400';
                          break;
                        case 'sampleSize':
                          value = entry.total;
                          display = entry.total >= SAMPLE_SIZE_TARGET
                            ? t('dashboard.subjectMetrics.sampleSizeReady')
                            : t('dashboard.subjectMetrics.sampleSizeProgress', { count: entry.total, target: SAMPLE_SIZE_TARGET });
                          textColor = entry.total >= SAMPLE_SIZE_TARGET
                            ? 'text-emerald-600'
                            : entry.total === 0
                              ? 'text-slate-400'
                              : 'text-slate-600';
                          chartColor = 'bg-slate-400';
                          break;
                        default:
                          if (!hasAnswers) {
                            value = 0;
                            display = t('dashboard.subjectMetrics.noData');
                            textColor = 'text-slate-400';
                            chartColor = 'text-violet-300';
                            level = null;
                          } else {
                            value = confidence;
                            display = `${confidence}%`;
                            textColor = confidence >= 70 ? 'text-violet-700' : confidence >= 40 ? 'text-violet-500' : 'text-violet-400';
                            chartColor = confidence >= 70 ? 'text-violet-600' : confidence >= 40 ? 'text-violet-400' : 'text-violet-300';
                            level = t(confidenceLevelKey(confidence));
                          }
                          break;
                      }

                      const evidenceText = hasAnswers
                        ? t('dashboard.subjectConfidenceEvidence', {
                          correct: entry.correct,
                          total: entry.total,
                          accuracy: entry.score,
                        })
                        : t('dashboard.subjectConfidenceNoEvidence');
                      const isInsufficient = hasAnswers && entry.total < SAMPLE_SIZE_TARGET;

                      return (
                        <div key={entry.name} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: entry.fill || chartColors[index % chartColors.length] }}
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-700 truncate">{entry.name}</p>
                              {hasAnswers ? (
                                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                  {evidenceText}
                                  {isInsufficient && (
                                    <span title={t('dashboard.subjectMetrics.estimating')}>{t('dashboard.subjectMetrics.estimating')}</span>
                                  )}
                                </p>
                              ) : (
                                <p className="text-xs truncate">
                                  <Link href="/create" className="text-primary hover:underline">
                                    {t('dashboard.subjectConfidenceStartPractice')}
                                  </Link>
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex w-20 sm:w-28 items-center justify-center shrink-0">
                            {subjectMetricView === 'confidence' && (
                              <ConfidenceGauge value={hasAnswers ? confidence : 0} color={chartColor} delay={index * 60} />
                            )}
                            {subjectMetricView === 'accuracy' && (
                              <AccuracyRing
                                ratio={hasAnswers ? entry.score / 100 : 0}
                                color={chartColor}
                                label={hasAnswers ? `${entry.score}%` : t('dashboard.subjectMetrics.noData')}
                                delay={index * 60}
                              />
                            )}
                            {subjectMetricView === 'stability' && (
                              <StabilitySegments value={value ?? 0} empty={!hasAnswers} delay={index * 60} />
                            )}
                            {subjectMetricView === 'guessRisk' && (
                              <RiskScale value={value ?? 0} empty={!hasAnswers} delay={index * 60} />
                            )}
                            {subjectMetricView === 'avgTime' && (
                              <TimeIntervalBar
                                avgSeconds={avgSeconds}
                                fastLimit={TIME_FAST_LIMIT_SECONDS}
                                slowLimit={TIME_SLOW_LIMIT_SECONDS}
                                empty={!hasAnswers}
                                delay={index * 60}
                              />
                            )}
                            {subjectMetricView === 'sampleSize' && (
                              <SampleSizeProgress total={entry.total} target={SAMPLE_SIZE_TARGET} delay={index * 60} />
                            )}
                          </div>
                          <div className="w-12 shrink-0 text-right">
                            <div className={cn('text-sm font-bold tabular-nums', textColor)}>{display}</div>
                            {level && <div className="text-xs font-medium text-muted-foreground">{level}</div>}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="flex h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  {t('dashboard.noPerformance')}
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {(widgetVisibility.recentInsights || widgetVisibility.nextMilestone) && (
          <div className="space-y-6">
            {widgetVisibility.recentInsights && (
            <CardCarousel
              title={t('dashboard.recentInsights')}
              items={insightCards.map(card => {
                const inner = (
                  <div className={cn('flex items-start gap-3 p-3 rounded-xl border', card.color, card.href && 'hover:opacity-80 transition-opacity')}>
                    <div className={cn('mt-0.5 shrink-0', card.color.split(' ')[2])}>{card.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-[10px] font-bold uppercase tracking-wider mb-1', card.color.split(' ')[2])}>{card.label}</p>
                      <div>{card.value}</div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-snug truncate">{card.sub}</p>
                    </div>
                  </div>
                );
                return card.href ? (
                  <Link key={card.id} href={card.href} className="block">{inner}</Link>
                ) : (
                  <div key={card.id}>{inner}</div>
                );
              })}
              itemsPerPage={2}
              autoPlayInterval={10000}
              style={{ transitionDelay: '360ms' }}
              emptyState={
                <div className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
                  <BookOpen className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-secondary">{t('dashboard.noAnswers')}</p>
                    <p className="text-xs text-muted-foreground">{t('dashboard.noAnswersDescription')}</p>
                  </div>
                </div>
              }
            />
            )}

            {widgetVisibility.nextMilestone && (() => {
              const allTasksCompleted = isNewCompleted && isReviewCompleted && isIncorrectCompleted;

              const newPracticeDetails = plannedNewChapterIds.map(id => {
                for (const s of missionSubjects) {
                  const ch = s.chapters.find(c => c.id === id);
                  if (ch) return `${s.name}: ${ch.name}`;
                }
                return '';
              }).filter(Boolean);

              const lSubj = (name: string) => localizeLabel(name, language, SUBJECT_ZH);
              const lChap = (name: string) => localizeLabel(name, language, CHAPTER_ZH);

              const handleStartSelected = () => {
                handleStartMission(selectedTaskType);
              };

              return (
                <CardCarousel
                  title={t('dashboard.recommendedTasks')}
                  className="bg-[#faf6f0] border-[#ebd9b8]"
                  titleClassName="text-amber-800"
                  selectedIndex={['new', 'review', 'incorrect'].indexOf(selectedTaskType)}
                  onIndexChange={(index) => {
                    const types = ['new', 'review', 'incorrect'] as const;
                    setSelectedTaskType(types[index]);
                  }}

                  items={[
                    <div 
                      key="new"
                      className={`flex-1 h-full flex items-start space-x-3 p-4 rounded-lg border shadow-sm transition-colors ${isNewCompleted ? 'bg-white border-green-200' : 'bg-white border-amber-200 ring-1 ring-amber-100'}`}
                    >
                      {isNewCompleted ? (
                        <CheckCircle2 className="mt-1 w-5 h-5 text-green-500 shrink-0" />
                      ) : (
                        <Circle className="mt-1 w-5 h-5 text-amber-300 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold leading-none mb-1 ${isNewCompleted ? 'text-green-800' : 'text-slate-800'}`}>{t('dashboard.taskNewPractice')}</p>
                        <p className="text-xs text-muted-foreground">{t('dashboard.taskNewPracticeDesc', { count: reviewSplit.newQuota })}</p>
                        {newPracticeDetails.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {Object.entries(
                              newPracticeDetails.slice(0, 3).reduce((acc, detail) => {
                                const parts = detail.split(': ');
                                const subj = parts[0];
                                const chap = parts.slice(1).join(': ');
                                if (!acc[subj]) acc[subj] = [];
                                if (chap) acc[subj].push(chap);
                                return acc;
                              }, {} as Record<string, string[]>)
                            ).map(([subj, chaps], idx) => (
                              <div key={idx} className="flex flex-wrap items-center gap-1.5">
                                <span className="px-2 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full whitespace-nowrap">
                                  {lSubj(subj)}
                                </span>
                                {chaps.map((chap, cIdx) => (
                                  <span key={cIdx} className="px-2 py-0.5 text-[10px] font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-full">
                                    {lChap(chap)}
                                  </span>
                                ))}
                              </div>
                            ))}
                            {newPracticeDetails.length > 3 && (
                              <div className="text-xs text-muted-foreground pl-1">
                                ... {newPracticeDetails.length - 3} more
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>,
                    <div 
                      key="review"
                      className={`flex-1 h-full flex items-start space-x-3 p-4 rounded-lg border shadow-sm transition-colors ${isReviewCompleted ? 'bg-white border-green-200' : 'bg-white border-amber-200 ring-1 ring-amber-100'}`}
                    >
                      {isReviewCompleted ? (
                        <CheckCircle2 className="mt-1 w-5 h-5 text-green-500 shrink-0" />
                      ) : (
                        <Circle className="mt-1 w-5 h-5 text-amber-300 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold leading-none mb-1 ${isReviewCompleted ? 'text-green-800' : 'text-slate-800'}`}>{t('dashboard.taskReview')}</p>
                        <p className="text-xs text-muted-foreground">{t('dashboard.taskReviewDesc', { count: dueReviewChapters.length })}</p>
                        {dueReviewChapters.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {Object.entries(
                              dueReviewChapters.slice(0, 3).reduce((acc, chapter) => {
                                if (!acc[chapter.subject]) acc[chapter.subject] = [];
                                acc[chapter.subject].push(chapter.chapterName);
                                return acc;
                              }, {} as Record<string, string[]>)
                            ).map(([subj, chaps], idx) => (
                              <div key={idx} className="flex flex-wrap items-center gap-1.5">
                                <span className="px-2 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full whitespace-nowrap">
                                  {lSubj(subj)}
                                </span>
                                {chaps.map((chap, cIdx) => (
                                  <span key={cIdx} className="px-2 py-0.5 text-[10px] font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-full">
                                    {lChap(chap)}
                                  </span>
                                ))}
                              </div>
                            ))}
                            {dueReviewChapters.length > 3 && (
                              <div className="text-xs text-muted-foreground pl-1">
                                ... {dueReviewChapters.length - 3} more
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>,
                    <div 
                      key="incorrect"
                      className={`flex-1 h-full flex items-start space-x-3 p-4 rounded-lg border shadow-sm transition-colors ${isIncorrectCompleted ? 'bg-white border-green-200' : 'bg-white border-amber-200 ring-1 ring-amber-100'}`}
                    >
                      {isIncorrectCompleted ? (
                        <CheckCircle2 className="mt-1 w-5 h-5 text-green-500 shrink-0" />
                      ) : (
                        <Circle className="mt-1 w-5 h-5 text-amber-300 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold leading-none mb-1 ${isIncorrectCompleted ? 'text-green-800' : 'text-slate-800'}`}>{t('dashboard.taskIncorrect')}</p>
                        <p className="text-xs text-muted-foreground">{t('dashboard.taskIncorrectDesc', { count: dashboardData.incorrectCount })}</p>
                      </div>
                    </div>
                  ]}
                  itemsPerPage={1}
                  autoPlayInterval={10000}
                  style={{ transitionDelay: '420ms' }}
                  footer={
                    <Button 
                      className="w-full mt-4 bg-amber-600 hover:bg-amber-700 text-white" 
                      size="lg"
                      onClick={handleStartSelected} 
                      disabled={generatingMission || (selectedTaskType === 'new' && isNewCompleted) || (selectedTaskType === 'review' && isReviewCompleted) || (selectedTaskType === 'incorrect' && isIncorrectCompleted)}
                    >
                      {t('dashboard.startLearning')}
                    </Button>
                  }
                  emptyState={
                    <div className="flex flex-col items-center justify-center p-4 text-center">
                      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                        <CheckCircle2 className="w-6 h-6 text-green-600" />
                      </div>
                      <p className="text-sm font-medium text-green-700">{t('dashboard.allTasksCompleted')}</p>
                    </div>
                  }
                />
              );
            })()}
          </div>
          )}
        </div>

        {/* Activity Heatmap — kept at the end of the dashboard */}
        {widgetVisibility.activityHeatmap && (
          <ActivityHeatmap
            dailyCounts={dashboardData.dailyCounts}
            loading={dashboardData.loading}
            t={t}
          />
        )}
      </div>

      <GuidedTour
        open={tourOpen}
        steps={tourSteps}
        onOpenChange={closeTour}
        stepLabel={(current, total) => t('tour.stepOf', { current, total })}
        backLabel={t('tour.back')}
        nextLabel={t('tour.next')}
        doneLabel={t('tour.done')}
      />
    </>
  );
}
