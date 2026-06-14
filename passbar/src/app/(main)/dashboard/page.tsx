"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Flag,
  Flame,
  Loader2,
  Play,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { getSubjects } from '@/lib/question-bank';
import type { Subject } from '@/lib/types';
import { getQuestionStatusCounts, emptyQuestionStatusCounts, type QuestionStatusCounts } from '@/lib/question-progress';
import {
  calculateDailyQuota,
  calculateSubjectQuotas,
  generateTodayMissionSession,
  getDueReviewChapters,
  splitQuotaForReview,
  type ChapterAttemptStats,
} from '@/lib/smart-planner';
import { saveUserStudySettings } from '@/lib/user-settings';
import { saveStudySettings, defaultStudySettings, normalizeStudySettings, defaultDashboardWidgets, type DashboardWidgetKey, type DashboardWidgetVisibility } from '@/lib/study-settings';
import { SmartStudyCalendar } from '@/components/SmartStudyCalendar';

type SubjectCountRow = {
  subject: string;
  count: number;
};

type QuestionProgressRow = {
  status: 'correct' | 'incorrect' | 'omitted';
  is_correct: boolean | null;
  time_spent_seconds: number | null;
  last_answered_at: string | null;
  question_items?: {
    chapters?: {
      id?: string | null;
      chapter?: string | null;
      subject?: string | null;
    } | null;
  } | null;
};

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

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 分';
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs    = Math.floor(totalSeconds % 60);
  if (hours > 0 && minutes > 0) return `${hours} 小時 ${minutes} 分`;
  if (hours > 0)                return `${hours} 小時`;
  if (minutes > 0)              return `${minutes} 分`;
  return `${secs} 秒`;
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

async function loadDashboardData(userId: string): Promise<Omit<DashboardData, 'loading'>> {
  if (!supabase) {
    return {
      error: 'Supabase is not configured.',
      totalQuestions: 0,
      solvedQuestions: 0,
      practiceAttempts: 0,
      solvedToday: 0,
      mastery: 0,
      streakDays: 0,
      timeTodaySeconds: 0,
      subjectPerformance: [],
      dailyCounts: {},
      recentAccuracy: null,
      incorrectCount: 0,
      weeklyStudyTimeSeconds: 0,
      bestStreak: 0,
      avgSecondsPerQuestion: 0,
      chapterStats: [],
    };
  }

  const todayStartIso = startOfLocalDay(new Date()).toISOString();
  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [subjectCountsResult, answersResult, attemptsResult, todaySessionsResult, weeklySessionsResult] = await Promise.all([
    supabase
      .from('question_chapter_counts')
      .select('subject, count'),
    supabase
      .from('user_question_progress')
      .select('status, is_correct, time_spent_seconds, last_answered_at, question_items(chapters(id, chapter, subject))')
      .eq('user_id', userId),
    supabase
      .from('practice_answers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    // Today's practice sessions — source of truth for time spent
    supabase
      .from('practice_sessions')
      .select('started_at, completed_at, total_time_seconds, status')
      .eq('user_id', userId)
      .gte('started_at', todayStartIso),
    // Last-7-day sessions for weekly study time
    supabase
      .from('practice_sessions')
      .select('started_at, completed_at, total_time_seconds, status')
      .eq('user_id', userId)
      .gte('started_at', weekAgoIso),
  ]);

  if (subjectCountsResult.error) throw subjectCountsResult.error;
  if (answersResult.error) throw answersResult.error;
  if (attemptsResult.error) throw attemptsResult.error;
  // todaySessionsResult errors are non-fatal — degrade gracefully

  const subjectCounts = new Map<string, number>();
  ((subjectCountsResult.data ?? []) as SubjectCountRow[]).forEach((row) => {
    subjectCounts.set(row.subject, (subjectCounts.get(row.subject) ?? 0) + row.count);
  });

  const totalQuestions = Array.from(subjectCounts.values()).reduce((sum, count) => sum + count, 0);
  const progressRows = (answersResult.data ?? []) as QuestionProgressRow[];
  const answers = progressRows.filter((answer) => answer.status === 'correct' || answer.status === 'incorrect');
  const solvedQuestions = answers.length;
  const correctAnswers = answers.filter((answer) => answer.is_correct).length;
  const mastery = solvedQuestions > 0 ? (correctAnswers / solvedQuestions) * 100 : 0;
  const todayStart = startOfLocalDay(new Date()).getTime();
  const todaysAnswers = answers.filter((answer) => {
    if (!answer.last_answered_at) return false;
    return new Date(answer.last_answered_at).getTime() >= todayStart;
  });

  const answeredDates = answers
    .map((answer) => answer.last_answered_at)
    .filter((value): value is string => Boolean(value));

  // Build daily counts map for heatmap
  const dailyCounts: Record<string, number> = {};
  answeredDates.forEach((dateStr) => {
    const key = startOfLocalDay(new Date(dateStr)).toISOString().slice(0, 10);
    dailyCounts[key] = (dailyCounts[key] ?? 0) + 1;
  });

  const subjectStats = new Map<string, { correct: number; total: number }>();
  answers.forEach((answer) => {
    const subject = answer.question_items?.chapters?.subject ?? 'Uncategorized';
    const existing = subjectStats.get(subject) ?? { correct: 0, total: 0 };
    existing.total += 1;
    if (answer.is_correct) existing.correct += 1;
    subjectStats.set(subject, existing);
  });

  const subjectNames = Array.from(new Set([
    ...Array.from(subjectCounts.keys()),
    ...Array.from(subjectStats.keys()),
  ])).sort((a, b) => a.localeCompare(b));

  const subjectPerformance = subjectNames.map((subject, index) => {
    const stats = subjectStats.get(subject) ?? { correct: 0, total: 0 };
    return {
      name: subject,
      score: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
      correct: stats.correct,
      total: stats.total,
      fill: chartColors[index % chartColors.length],
    };
  });

  // ── Today's practice time ────────────────────────────────────────────────
  // Primary source: practice_sessions (total_time_seconds for completed,
  //                 elapsed wall-clock for in_progress as fallback)
  const now = Date.now();
  type SessionRow = { started_at: string; completed_at: string | null; total_time_seconds: number | null; status: string };
  const todaySessions = ((todaySessionsResult.data ?? []) as SessionRow[]);
  const timeTodayFromSessions = todaySessions.reduce((sum, s) => {
    if (s.total_time_seconds != null && s.total_time_seconds > 0) {
      return sum + s.total_time_seconds;
    }
    // In-progress or missing total: estimate from wall-clock
    const start = new Date(s.started_at).getTime();
    const end   = s.completed_at ? new Date(s.completed_at).getTime() : now;
    return sum + Math.max(0, (end - start) / 1000);
  }, 0);

  // Fallback: per-question time_spent_seconds (if sessions not tracked)
  const timeTodayFromAnswers = todaysAnswers.reduce(
    (sum, answer) => sum + (answer.time_spent_seconds ?? 0), 0,
  );

  // Use whichever source reports more time (they shouldn't both be > 0 for same session)
  const timeTodaySeconds = Math.max(timeTodayFromSessions, timeTodayFromAnswers);

  // ── Weekly study time ────────────────────────────────────────────────────
  const weeklySessions = ((weeklySessionsResult.data ?? []) as SessionRow[]);
  const weeklyStudyTimeSeconds = weeklySessions.reduce((sum, s) => {
    if (s.total_time_seconds != null && s.total_time_seconds > 0) return sum + s.total_time_seconds;
    const start = new Date(s.started_at).getTime();
    const end = s.completed_at ? new Date(s.completed_at).getTime() : now;
    return sum + Math.max(0, (end - start) / 1000);
  }, 0);

  // ── Recent accuracy (last 7 days) ────────────────────────────────────────
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentAnswers = answers.filter((a) => a.last_answered_at && new Date(a.last_answered_at).getTime() >= sevenDaysAgo);
  const recentAccuracy = recentAnswers.length > 0
    ? Math.round((recentAnswers.filter((a) => a.is_correct).length / recentAnswers.length) * 100)
    : null;

  // ── Incorrect count & best streak ────────────────────────────────────────
  const incorrectCount = answers.filter((a) => !a.is_correct).length;
  const bestStreak = calculateBestStreak(answeredDates);

  // ── Average time per answered question ──────────────────────────────────
  const timedAnswers = answers.filter((a) => (a.time_spent_seconds ?? 0) > 0);
  const avgSecondsPerQuestion = timedAnswers.length > 0
    ? timedAnswers.reduce((sum, a) => sum + (a.time_spent_seconds ?? 0), 0) / timedAnswers.length
    : 0;

  // ── Per-chapter attempt aggregates (for spaced-repetition review queue) ──
  const chapterStatsMap = new Map<string, ChapterAttemptStats>();
  answers.forEach((answer) => {
    const chapter = answer.question_items?.chapters;
    if (!chapter?.id || !answer.last_answered_at) return;

    const existing = chapterStatsMap.get(chapter.id) ?? {
      chapterId: chapter.id,
      chapterName: chapter.chapter ?? chapter.id,
      subject: chapter.subject ?? 'Uncategorized',
      attempts: 0,
      correct: 0,
      lastAttemptAt: answer.last_answered_at,
    };

    existing.attempts += 1;
    if (answer.is_correct) existing.correct += 1;
    if (answer.last_answered_at > existing.lastAttemptAt) existing.lastAttemptAt = answer.last_answered_at;

    chapterStatsMap.set(chapter.id, existing);
  });
  const chapterStats = Array.from(chapterStatsMap.values());

  return {
    error: null,
    totalQuestions,
    solvedQuestions,
    practiceAttempts: attemptsResult.count ?? solvedQuestions,
    solvedToday: todaysAnswers.length,
    mastery,
    streakDays: calculateStreak(answeredDates),
    timeTodaySeconds,
    subjectPerformance,
    dailyCounts,
    recentAccuracy,
    incorrectCount,
    weeklyStudyTimeSeconds,
    bestStreak,
    avgSecondsPerQuestion,
    chapterStats,
  };
}

function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;
    if (target === 0) { setValue(0); return; }

    const start = Date.now();
    const from = value;
    const diff = target - from;
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + diff * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
  const days = examDate ? daysUntilExam(examDate) : null;

  // Not set yet → subtle link
  if (days === null) {
    return (
      <button
        onClick={onSetDate}
        className={cn('text-xs text-primary hover:underline font-medium transition-colors', className)}
      >
        ＋ 設定考試日期
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
      ? `${examLabel} 已結束`
      : days === 0
        ? `🎯 今天就是 ${examLabel}！`
        : `距離 ${examLabel} 還有 ${days} 天`;

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
            <span className="text-xs text-muted-foreground">{totalDaysActive} 天有練習</span>
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

function confidenceLevelKey(value: number): 'plan.confidenceStrong' | 'plan.confidenceMedium' | 'plan.confidenceWeak' {
  if (value >= 70) return 'plan.confidenceStrong';
  if (value >= 40) return 'plan.confidenceMedium';
  return 'plan.confidenceWeak';
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
  totalQuestions,
  practicedQuestions,
  saving,
  onSave,
}: {
  onCancel: () => void;
  subjects: WeightSubject[];
  confidence: Record<string, number>;
  defaultConfidence: Record<string, number>;
  examDate: string | null;
  examState?: string | null;
  studyDays: number[];
  triageWeeks: number;
  dailyStudyHours: number;
  totalQuestions: number;
  practicedQuestions: number;
  saving: boolean;
  onSave: (next: { confidence: Record<string, number>; studyDays: number[]; examDate: string | null; examState: string | null; dailyStudyHours: number }) => void;
}) {
  const { t } = useI18n();
  const dayKeys = ['plan.day.sun', 'plan.day.mon', 'plan.day.tue', 'plan.day.wed', 'plan.day.thu', 'plan.day.fri', 'plan.day.sat'] as const;

  const [tempConfidence, setTempConfidence] = useState<Record<string, number>>(confidence);
  const [tempStudyDays, setTempStudyDays] = useState<number[]>(studyDays);
  const [tempExamDate, setTempExamDate] = useState<string | null>(examDate);
  const [tempExamState, setTempExamState] = useState<string | null>(examState ?? null);
  const [tempDailyStudyHours, setTempDailyStudyHours] = useState<number>(dailyStudyHours);

  const quotaPreview = useMemo(
    () => calculateDailyQuota(totalQuestions, practicedQuestions, tempExamDate, tempStudyDays, triageWeeks, tempDailyStudyHours),
    [totalQuestions, practicedQuestions, tempExamDate, tempStudyDays, triageWeeks, tempDailyStudyHours],
  );

  const subjectQuotas = useMemo(
    () => calculateSubjectQuotas(subjects.map((s) => ({ name: s.name, remaining: s.remaining })), quotaPreview.quota, tempConfidence),
    [subjects, quotaPreview.quota, tempConfidence],
  );

  const toggleStudyDay = (day: number) => {
    setTempStudyDays((current) => (
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    ));
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="grid gap-6 md:grid-cols-2">
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
                })}
              </p>
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
          onClick={() => onSave({ confidence: tempConfidence, studyDays: tempStudyDays, examDate: tempExamDate, examState: tempExamState, dailyStudyHours: tempDailyStudyHours })}
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
  const { t } = useI18n();
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyDashboardData);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [examState, setExamState] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  // ── Today's Mission (Smart Plan) ─────────────────────────────────────────
  const [missionSubjects, setMissionSubjects] = useState<Subject[]>([]);
  const [missionStatusCounts, setMissionStatusCounts] = useState<QuestionStatusCounts>(emptyQuestionStatusCounts);
  const [generatingMission, setGeneratingMission] = useState(false);
  const [showWeightDialog, setShowWeightDialog] = useState(false);
  const [savingWeights, setSavingWeights] = useState(false);

  // ── Widget visibility ────────────────────────────────────────────────────
  const [widgetVisibility, setWidgetVisibility] = useState<DashboardWidgetVisibility>(defaultDashboardWidgets);
  const [showWidgetPanel, setShowWidgetPanel] = useState(false);

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
      ...(profile?.study_settings ?? defaultStudySettings),
      dashboardWidgets: next,
    });
    saveStudySettings(updatedSettings);
    if (user?.id) {
      await saveUserStudySettings(user.id, updatedSettings);
      await refreshProfile();
    }
  };

  // Load exam state from localStorage (keyed per user)
  useEffect(() => {
    if (!user?.id) return;
    const saved = localStorage.getItem(`passbar_exam_state_${user.id}`);
    if (saved) setExamState(saved);
  }, [user?.id]);

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
    if (!supabase || !user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({ exam_date: date })
      .eq('id', user.id)
      .select('id');          // forces 200 + body instead of 204 No Content
    if (error) {
      console.error('[PassBar] Failed to save exam_date:', error.message, error.code);
      setExamDate(profile?.exam_date ?? null); // revert
    } else {
      await refreshProfile();
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
  const studyDays = profile?.study_settings?.studyPlan?.studyDaysPerWeek ?? [1, 2, 3, 4, 5];
  const triageWeeks = profile?.study_settings?.studyPlan?.triageWeeks ?? 2;
  const dailyStudyHours = profile?.study_settings?.studyPlan?.dailyStudyHours ?? 3;

  const quotaInfo = useMemo(
    () => calculateDailyQuota(missionTotalQuestions, missionPracticedQuestions, examDate, studyDays, triageWeeks, dailyStudyHours),
    [missionTotalQuestions, missionPracticedQuestions, examDate, studyDays, triageWeeks, dailyStudyHours],
  );

  const subjectsWithRemaining = useMemo(
    () => missionSubjects.map((subject) => {
      const performance = dashboardData.subjectPerformance.find((p) => p.name === subject.name);
      const answered = performance?.total ?? 0;
      return {
        name: subject.name,
        total: subject.count,
        remaining: Math.max(0, subject.count - answered),
      };
    }),
    [missionSubjects, dashboardData.subjectPerformance],
  );

  const defaultConfidence = useMemo(() => {
    const result: Record<string, number> = {};
    subjectsWithRemaining.forEach((subject) => {
      const performance = dashboardData.subjectPerformance.find((p) => p.name === subject.name);
      result[subject.name] = performance && performance.total > 0 ? performance.score : 50;
    });
    return result;
  }, [subjectsWithRemaining, dashboardData.subjectPerformance]);

  const savedConfidence = profile?.study_settings?.studyPlan?.subjectConfidence;

  const subjectConfidence = useMemo(
    () => ({ ...defaultConfidence, ...(savedConfidence ?? {}) }),
    [defaultConfidence, savedConfidence],
  );

  const dueReviewChapters = useMemo(
    () => getDueReviewChapters(dashboardData.chapterStats),
    [dashboardData.chapterStats],
  );

  const reviewSplit = useMemo(
    () => splitQuotaForReview(quotaInfo.quota, dueReviewChapters.length),
    [quotaInfo.quota, dueReviewChapters.length],
  );

  const subjectQuotas = useMemo(
    () => calculateSubjectQuotas(subjectsWithRemaining, reviewSplit.newQuota, subjectConfidence),
    [subjectsWithRemaining, reviewSplit.newQuota, subjectConfidence],
  );

  const handleStartMission = async () => {
    if (!user) return;
    setGeneratingMission(true);
    const result = await generateTodayMissionSession(
      user.id,
      quotaInfo.quota,
      quotaInfo.triageMode,
      subjectQuotas,
      dueReviewChapters.map((c) => c.chapterId),
      reviewSplit.reviewQuota,
    );
    if (result) {
      router.push(`/test?id=${encodeURIComponent(result.session.id)}`);
    } else {
      setGeneratingMission(false);
      alert(t('plan.noQuestionsAlert'));
    }
  };

  const handleSaveWeights = async (next: { confidence: Record<string, number>; studyDays: number[]; examDate: string | null; examState: string | null; dailyStudyHours: number }) => {
    if (!user || !profile) return;
    setSavingWeights(true);
    const updatedSettings = {
      ...(profile.study_settings ?? defaultStudySettings),
      studyPlan: {
        studyDaysPerWeek: next.studyDays,
        triageWeeks,
        subjectConfidence: next.confidence,
        dailyStudyHours: next.dailyStudyHours,
      },
    };
    saveStudySettings(updatedSettings);
    await saveUserStudySettings(user.id, updatedSettings);
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

  const [insightIndex, setInsightIndex] = useState(0);

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
      sub: <span>⏱ {formatDuration(dashboardData.timeTodaySeconds)}</span>,
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
      value: <span className="text-2xl font-bold text-indigo-900 leading-none">{formatDuration(Math.round(dashboardData.weeklyStudyTimeSeconds))}</span>,
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

  // Group cards into pages of 2
  const insightPages = useMemo(() => {
    const pages: InsightCard[][] = [];
    for (let i = 0; i < insightCards.length; i += 2) {
      pages.push(insightCards.slice(i, i + 2));
    }
    return pages;
  }, [insightCards]);

  // insightIndex is now the PAGE index
  const totalInsightPages = insightPages.length;

  // Auto-advance carousel every 10 seconds
  useEffect(() => {
    if (totalInsightPages <= 1) return;
    const timer = setInterval(() => setInsightIndex((i) => (i + 1) % totalInsightPages), 10000);
    return () => clearInterval(timer);
  }, [totalInsightPages]);

  const userFirstName = displayNameFromProfile(profile?.full_name, profile?.email ?? user?.email);
  const dayKeys = ['plan.day.sun', 'plan.day.mon', 'plan.day.tue', 'plan.day.wed', 'plan.day.thu', 'plan.day.fri', 'plan.day.sat'] as const;
  const remainingQuestions = Math.max(dashboardData.totalQuestions - dashboardData.solvedQuestions, 0);
  const nextMilestone = dashboardData.solvedQuestions === 0
    ? Math.min(25, dashboardData.totalQuestions || 25)
    : Math.max(10, 50 - (dashboardData.solvedQuestions % 50));

  const SAFE_PASS_THRESHOLD = 75;
  const completionRate = dashboardData.totalQuestions > 0
    ? (dashboardData.solvedQuestions / dashboardData.totalQuestions) * 100
    : 0;
  const streakBadgeMilestones: Array<{ days: number; key: 'dashboard.badge.discipline' | 'dashboard.badge.consistency' | 'dashboard.badge.master' }> = [
    { days: 7, key: 'dashboard.badge.discipline' },
    { days: 30, key: 'dashboard.badge.consistency' },
    { days: 100, key: 'dashboard.badge.master' },
  ];
  const nextStreakBadge = streakBadgeMilestones.find((m) => dashboardData.streakDays < m.days);
  const estimatedRemainingHours = Math.round(
    (remainingQuestions * (dashboardData.avgSecondsPerQuestion || 90)) / 3600,
  );

  const masteryDisplay = useCountUp(Math.round(dashboardData.loading ? 0 : dashboardData.mastery));
  const todayDisplay = startOfLocalDay(new Date()).toISOString().slice(0, 10);

  return (
    <>
      <div
        className={cn(
          'space-y-8 transition-all duration-700',
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        )}
      >
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
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
              {examDate && (
                <span className="text-xs text-muted-foreground">
                  {t('plan.planningRange', { start: todayDisplay, end: examDate })}
                </span>
              )}
            </div>
          </div>

          {/* Right: action buttons — aligned to bottom of left column */}
          <div className="flex flex-row gap-2.5 shrink-0">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none h-11 px-5 text-sm shadow-sm gap-2"
              onClick={() => setShowWeightDialog(true)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t('dashboard.customWeights')}
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none h-11 px-5 text-sm shadow-sm gap-2"
              onClick={() => setShowWidgetPanel((v) => !v)}
            >
              <Settings className="h-4 w-4" />
              {t('dashboard.customizeWidgets')}
            </Button>
            <Button asChild className="flex-1 sm:flex-none h-11 px-5 text-sm font-semibold shadow-md shadow-primary/20">
              <Link href="/create" className="flex items-center justify-center gap-2">
                <Play className="w-4 h-4 fill-current shrink-0" />
                {t('dashboard.startNewSession')}
              </Link>
            </Button>
          </div>
        </header>

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
        <Card className="border-primary/20 bg-primary/5 shadow-sm transition-all duration-500 hover:shadow-md">
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
          <CardContent className="space-y-4">
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
                  <div className="flex flex-col items-center text-center gap-3">
                    <p className="text-sm text-slate-700 max-w-md">
                      {t('plan.missionDescriptionPrefix', { date: examDate })}
                    </p>
                    <div className="flex items-end justify-center gap-1.5">
                      <span className="text-5xl font-bold text-primary leading-none tabular-nums">{quotaInfo.quota}</span>
                      <span className="text-base font-semibold text-muted-foreground mb-1.5">{t('plan.missionDescriptionSuffix')}</span>
                    </div>
                    {reviewSplit.reviewQuota > 0 && (
                      <p className="text-sm text-muted-foreground max-w-md">
                        {t('plan.missionSplitHint', { review: reviewSplit.reviewQuota, new: reviewSplit.newQuota })}
                      </p>
                    )}
                    {weakFocusSubjects.length > 0 && (
                      <p className="text-sm text-muted-foreground max-w-md">
                        {t('plan.weakFocusHint', { subjects: weakFocusSubjects.join('、') })}
                      </p>
                    )}
                    <Button
                      size="lg"
                      className="h-11 px-5 text-sm font-semibold shadow-md shadow-primary/20"
                      onClick={handleStartMission}
                      disabled={generatingMission}
                    >
                      {generatingMission && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {generatingMission ? t('plan.preparingMission') : t('plan.startMission', { count: quotaInfo.quota })}
                    </Button>
                    {quotaInfo.triageMode && (
                      <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 flex items-center justify-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t('plan.sprintMode')}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-green-700 text-center py-2">
                    <CheckCircle2 className="mx-auto h-8 w-8 mb-2 opacity-80" />
                    <p className="text-sm font-semibold">{t('plan.allDoneTitle')}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t('plan.allDoneDescription')}</p>
                  </div>
                )}

                {/* Schedule overview */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-primary/10">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('plan.remainingQuestions')}</span>
                    <span className="text-2xl font-bold">{quotaInfo.remainingQuestions}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('plan.availableStudyDays')}</span>
                    <span className="text-2xl font-bold">{t('plan.daysUnit', { count: quotaInfo.availableDays })}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('plan.weeklySprintDays')}</span>
                    <span className="text-2xl font-bold">{t('plan.daysUnit', { count: studyDays.length })}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('plan.estimatedTotalTime')}</span>
                    <span className="text-2xl font-bold">
                      {formatDuration(quotaInfo.remainingQuestions * (dashboardData.avgSecondsPerQuestion || 90))}
                    </span>
                  </div>
                </div>

                {/* Weekly routine */}
                <div className="flex justify-between pt-1">
                  {dayKeys.map((dayKey, i) => {
                    const isStudyDay = studyDays.includes(i);
                    const isToday = new Date().getDay() === i;
                    return (
                      <div key={i} className="flex flex-col items-center gap-1.5">
                        <span className={cn('text-xs', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>
                          {t(dayKey)}
                        </span>
                        <div className={cn(
                          'h-7 w-7 rounded-full flex items-center justify-center',
                          isStudyDay
                            ? isToday ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-primary/10 text-primary'
                            : 'bg-slate-50 text-slate-300',
                        )}>
                          {isStudyDay && <CheckCircle2 className="h-3.5 w-3.5" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        )}

        {/* Spaced Review (Ebbinghaus forgetting curve) */}
        {widgetVisibility.spacedReview && (
        <Card className="hover:shadow-md transition-shadow">
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
                        {chapter.subject} · {chapter.chapterName}
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
          <SmartStudyCalendar
            examDate={examDate}
            studyDays={studyDays}
            dailyQuota={quotaInfo.quota}
            remainingQuestions={quotaInfo.remainingQuestions}
            triageWeeks={triageWeeks}
            subjectQuotas={subjectQuotas}
            subjectsWithRemaining={subjectsWithRemaining}
            dailyCounts={dashboardData.dailyCounts}
            onStartToday={handleStartMission}
            startingMission={generatingMission}
          />
        )}

        {dashboardData.error ? (
          <Card className="border-red-100 bg-red-50 text-red-800">
            <CardContent className="py-4 text-sm">
              Dashboard data could not be loaded: {dashboardData.error}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  {t('dashboard.streakBadgeHint', {
                    days: nextStreakBadge.days - dashboardData.streakDays,
                    badge: t(nextStreakBadge.key),
                  })}
                </p>
              )}
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
                  <h3 className="text-2xl font-bold mt-1">{dashboardData.loading ? '—' : formatDuration(dashboardData.timeTodaySeconds)}</h3>
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

        {/* Activity Heatmap */}
        {widgetVisibility.activityHeatmap && (
          <ActivityHeatmap
            dailyCounts={dashboardData.dailyCounts}
            loading={dashboardData.loading}
            t={t}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {widgetVisibility.subjectPerformance && (
          <Card className="lg:col-span-2 shadow-md transition-all duration-700 hover:shadow-lg" style={{ transitionDelay: '300ms' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">{t('dashboard.subjectPerformance')}</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{t('dashboard.subjectPerformanceDescription')}</p>
            </CardHeader>
            <CardContent>
              {dashboardData.subjectPerformance.length > 0 ? (
                <div className="space-y-3">
                  {dashboardData.subjectPerformance
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .map((entry, index) => {
                      const hasAnswers = entry.total > 0;
                      const scoreColor =
                        !hasAnswers ? 'bg-slate-200' :
                        entry.score >= 70 ? 'bg-green-500' :
                        entry.score >= 50 ? 'bg-amber-500' : 'bg-red-400';
                      const scoreText =
                        !hasAnswers ? 'text-slate-400' :
                        entry.score >= 70 ? 'text-green-600' :
                        entry.score >= 50 ? 'text-amber-600' : 'text-red-500';
                      return (
                        <div key={entry.name} className="group">
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: entry.fill || chartColors[index % chartColors.length] }}
                              />
                              <span className="text-sm font-medium text-slate-700 truncate">{entry.name}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-xs text-muted-foreground">
                                {hasAnswers ? `${entry.correct}/${entry.total}` : t('dashboard.noPerformance').slice(0, 5) + '…'}
                              </span>
                              <span className={cn('text-sm font-bold w-10 text-right tabular-nums', scoreText)}>
                                {hasAnswers ? `${entry.score}%` : '—'}
                              </span>
                            </div>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={cn('h-full rounded-full transition-all duration-700', scoreColor)}
                              style={{
                                width: hasAnswers ? `${Math.max(entry.score, 2)}%` : '0%',
                                transitionDelay: `${index * 60}ms`,
                              }}
                            />
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
            <Card className="shadow-md transition-all duration-700 hover:shadow-lg" style={{ transitionDelay: '360ms' }}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">{t('dashboard.recentInsights')}</CardTitle>
                  {totalInsightPages > 1 && (
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalInsightPages }).map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setInsightIndex(i)}
                          className={cn(
                            'rounded-full transition-all duration-300',
                            i === insightIndex ? 'w-4 h-1.5 bg-primary' : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400',
                          )}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {insightPages.length === 0 ? (
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
                    <BookOpen className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-secondary">{t('dashboard.noAnswers')}</p>
                      <p className="text-xs text-muted-foreground">{t('dashboard.noAnswersDescription')}</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative overflow-hidden">
                    <div
                      className="flex transition-transform duration-500 ease-in-out"
                      style={{ transform: `translateX(-${insightIndex * 100}%)` }}
                    >
                      {insightPages.map((page, pi) => (
                        <div key={pi} className="w-full shrink-0 space-y-2">
                          {page.map((card) => {
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
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            )}

            {widgetVisibility.nextMilestone && (
            <Card className="shadow-md border-primary/20 bg-primary/5 transition-all duration-700 hover:shadow-lg" style={{ transitionDelay: '420ms' }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-primary">{t('dashboard.nextMilestone')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {t('dashboard.milestoneText', { count: nextMilestone.toLocaleString() })}
                </p>
                <Button className="w-full group" asChild>
                  <Link href="/create">
                    {t('dashboard.startLearning')}
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
            )}
          </div>
          )}
        </div>
      </div>
    </>
  );
}
