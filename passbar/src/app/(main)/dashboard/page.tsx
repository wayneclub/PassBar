"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CalendarDays,
  Clock,
  Flame,
  PlusCircle,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/components/AuthProvider';
import { getGeminiStatus } from '@/lib/gemini-feedback';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

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
  subjectPerformance: [],
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

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
    };
  }

  const [subjectCountsResult, answersResult, attemptsResult] = await Promise.all([
    supabase
      .from('question_chapter_counts')
      .select('subject, count'),
    supabase
      .from('user_question_progress')
      .select('status, is_correct, time_spent_seconds, last_answered_at, question_items(chapters(subject))')
      .eq('user_id', userId),
    supabase
      .from('practice_answers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  if (subjectCountsResult.error) throw subjectCountsResult.error;
  if (answersResult.error) throw answersResult.error;
  if (attemptsResult.error) throw attemptsResult.error;

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

  return {
    error: null,
    totalQuestions,
    solvedQuestions,
    practiceAttempts: attemptsResult.count ?? solvedQuestions,
    solvedToday: todaysAnswers.length,
    mastery,
    streakDays: calculateStreak(answeredDates),
    timeTodaySeconds: todaysAnswers.reduce((sum, answer) => sum + (answer.time_spent_seconds ?? 0), 0),
    subjectPerformance,
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

// ─── Exam Countdown Badge (inline in header) ─────────────────────────────────

function ExamCountdownInline({
  examDate,
  loading,
  solvedQuestions,
  totalQuestions,
  onSetDate,
  t,
}: {
  examDate: string | null;
  loading: boolean;
  solvedQuestions: number;
  totalQuestions: number;
  onSetDate: () => void;
  t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0], params?: Record<string, string | number>) => string;
}) {
  const days = examDate ? daysUntilExam(examDate) : null;

  const countdownText =
    days === null
      ? null
      : days < 0
        ? t('dashboard.examCountdownPast')
        : days === 0
          ? t('dashboard.examCountdownToday')
          : t('dashboard.examCountdownDays', { days });

  const countdownColor =
    days === null
      ? ''
      : days < 0
        ? 'text-slate-400'
        : days === 0
          ? 'text-amber-600'
          : days <= 7
            ? 'text-red-600'
            : days <= 30
              ? 'text-orange-500'
              : 'text-slate-600';

  const subtitleText = loading
    ? t('dashboard.loading')
    : solvedQuestions > 0
      ? t('dashboard.answered', { solved: solvedQuestions.toLocaleString(), total: totalQuestions.toLocaleString() })
      : t('dashboard.ready', { total: totalQuestions.toLocaleString() });

  return (
    <div className="flex items-center gap-2 mt-1 flex-wrap">
      {countdownText ? (
        <>
          <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className={cn('text-sm font-medium', countdownColor)}>{countdownText}</span>
          <button
            onClick={onSetDate}
            className="text-xs text-primary hover:underline font-medium transition-colors"
          >
            {t('dashboard.setExamDate')}
          </button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">{subtitleText}</p>
          <button
            onClick={onSetDate}
            className="text-xs text-primary hover:underline font-medium transition-colors"
          >
            {t('dashboard.setExamDate')}
          </button>
        </>
      )}
    </div>
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

function ExamDateDialog({
  open,
  currentDate,
  onClose,
  onSave,
}: {
  open: boolean;
  currentDate: string | null;
  onClose: () => void;
  onSave: (date: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<BarTab>('ca');
  const [otherState, setOtherState] = useState<string>('');
  // dateInput is in display format YYYY/MM/DD
  const [dateInput, setDateInput] = useState('');
  const [showCal, setShowCal] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);

  // Suggested next exam date for CA/NY tabs
  const suggestedDate = useMemo((): Date | null => {
    if (tab === 'ca') return nextBarExamDate('ca');
    if (tab === 'ny') return nextBarExamDate('ny');
    return null;
  }, [tab]);

  // On open, pre-fill from currentDate or auto-suggest CA tab
  useEffect(() => {
    if (!open) return;
    if (currentDate) {
      setDateInput(isoToDisplay(currentDate));
      setTab('custom');
    } else {
      setTab('ca');
      setDateInput(formatDateDisplay(nextBarExamDate('ca')));
    }
    setShowCal(false);
  }, [open, currentDate]);

  // When tab changes to ca/ny, auto-fill suggested date
  useEffect(() => {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-96 animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-50 border-b px-6 py-4">
          <h2 className="text-base font-bold text-slate-800">State Bar Exam</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('dashboard.setExamDate')}</p>
        </div>

        <div className="p-6 space-y-5">
          {/* Quick-select: CA / NY buttons + other states dropdown */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              {t('dashboard.examBarType')}
            </p>
            {/* Joined button group: CA | NY | Other */}
            <div className="flex w-full rounded-lg border border-slate-200 overflow-hidden divide-x divide-slate-200">
              <button
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

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              {t('dashboard.examDateCancel')}
            </Button>
            <Button
              className="flex-1"
              disabled={!isValid}
              onClick={() => {
                if (isValid) {
                  onSave(displayToIso(dateInput));
                  onClose();
                }
              }}
            >
              {t('dashboard.examDateSave')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyDashboardData);
  const [geminiStatus, setGeminiStatus] = useState<'enabled' | 'disabled' | 'unknown'>('unknown');
  const [examDate, setExamDate] = useState<string | null>(null);
  const [showExamDialog, setShowExamDialog] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (profile?.exam_date) setExamDate(profile.exam_date);
  }, [profile?.exam_date]);

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

  useEffect(() => {
    let active = true;
    getGeminiStatus()
      .then((status) => {
        if (active) setGeminiStatus(status);
      })
      .catch(() => {
        if (active) setGeminiStatus('unknown');
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSaveExamDate = async (date: string) => {
    setExamDate(date);
    if (!supabase || !user?.id) return;
    await supabase.from('profiles').update({ exam_date: date }).eq('id', user.id);
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

  const userFirstName = displayNameFromProfile(profile?.full_name, profile?.email ?? user?.email);
  const remainingQuestions = Math.max(dashboardData.totalQuestions - dashboardData.solvedQuestions, 0);
  const nextMilestone = dashboardData.solvedQuestions === 0
    ? Math.min(25, dashboardData.totalQuestions || 25)
    : Math.max(10, 50 - (dashboardData.solvedQuestions % 50));

  const masteryDisplay = useCountUp(Math.round(dashboardData.loading ? 0 : dashboardData.mastery));

  return (
    <>
      <ExamDateDialog
        open={showExamDialog}
        currentDate={examDate}
        onClose={() => setShowExamDialog(false)}
        onSave={handleSaveExamDate}
      />

      <div
        className={cn(
          'space-y-8 transition-all duration-700',
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        )}
      >
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-primary">{t('dashboard.welcome', { name: userFirstName })}</h1>
            {/* Subtitle line: exam countdown inline */}
            <ExamCountdownInline
              examDate={examDate}
              loading={dashboardData.loading}
              solvedQuestions={dashboardData.solvedQuestions}
              totalQuestions={dashboardData.totalQuestions}
              onSetDate={() => setShowExamDialog(true)}
              t={t}
            />
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/review">{t('dashboard.viewHistory')}</Link>
            </Button>
            <Button asChild>
              <Link href="/create" className="flex items-center gap-2">
                <PlusCircle className="w-4 h-4" />
                {t('dashboard.startNewSession')}
              </Link>
            </Button>
          </div>
        </header>

        {dashboardData.error ? (
          <Card className="border-red-100 bg-red-50 text-red-800">
            <CardContent className="py-4 text-sm">
              Dashboard data could not be loaded: {dashboardData.error}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
            </CardContent>
          </Card>

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
            </CardContent>
          </Card>

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
            </CardContent>
          </Card>

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
              <p className="text-xs text-muted-foreground mt-4">{t('dashboard.remaining', { count: remainingQuestions.toLocaleString() })}</p>
            </CardContent>
          </Card>

        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 shadow-md transition-all duration-700 hover:shadow-lg" style={{ transitionDelay: '300ms' }}>
            <CardHeader>
              <CardTitle>{t('dashboard.subjectPerformance')}</CardTitle>
              <CardDescription>{t('dashboard.subjectPerformanceDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {dashboardData.subjectPerformance.length > 0 ? (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={dashboardData.subjectPerformance}>
                      <XAxis
                        dataKey="name"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const row = payload[0].payload as SubjectPerformance;
                            return (
                              <div className="bg-white border rounded-lg p-3 shadow-lg">
                                <p className="font-bold text-primary">{row.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {t('review.accuracy')}: <span className="text-secondary font-bold">{row.score}%</span>
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t('performance.correctCount', { correct: row.correct, total: row.total })}
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="score" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={800} animationEasing="ease-out">
                        {dashboardData.subjectPerformance.map((entry, index) => (
                          <Cell key={`cell-${entry.name}`} fill={entry.fill || chartColors[index % chartColors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  {t('dashboard.noPerformance')}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="shadow-md transition-all duration-700 hover:shadow-lg" style={{ transitionDelay: '360ms' }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{t('dashboard.recentInsights')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {strongestSubject ? (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-100">
                    <TrendingUp className="w-5 h-5 text-green-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-green-900">
                        {t('dashboard.strongInsightTitle', { subject: strongestSubject.name })}
                      </p>
                      <p className="text-xs text-green-700">
                        {t('dashboard.strongInsightDescription', {
                          score: strongestSubject.score,
                          total: strongestSubject.total,
                        })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <BookOpen className="w-5 h-5 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-secondary">{t('dashboard.noAnswers')}</p>
                      <p className="text-xs text-muted-foreground">{t('dashboard.noAnswersDescription')}</p>
                    </div>
                  </div>
                )}

                {weakestSubject && weakestSubject.name !== strongestSubject?.name ? (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-100">
                    <Target className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-900">
                        {t('dashboard.reviewInsightTitle', { subject: weakestSubject.name })}
                      </p>
                      <p className="text-xs text-red-700">
                        {t('dashboard.reviewInsightDescription', {
                          score: weakestSubject.score,
                        })}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3',
                    geminiStatus === 'enabled' && 'border-primary/20 bg-primary/5',
                    geminiStatus === 'disabled' && 'border-amber-100 bg-amber-50',
                    geminiStatus === 'unknown' && 'border-slate-200 bg-slate-50',
                  )}
                >
                  <Sparkles
                    className={cn(
                      'mt-0.5 h-5 w-5',
                      geminiStatus === 'enabled' && 'text-primary',
                      geminiStatus === 'disabled' && 'text-amber-600',
                      geminiStatus === 'unknown' && 'text-slate-500',
                    )}
                  />
                  <div>
                    <p
                      className={cn(
                        'text-sm font-semibold',
                        geminiStatus === 'enabled' && 'text-secondary',
                        geminiStatus === 'disabled' && 'text-amber-900',
                        geminiStatus === 'unknown' && 'text-slate-800',
                      )}
                    >
                      {geminiStatus === 'enabled'
                        ? t('dashboard.aiFeedbackEnabled')
                        : geminiStatus === 'disabled'
                          ? t('dashboard.aiFeedbackDisabled')
                          : t('dashboard.aiFeedbackUnknown')}
                    </p>
                    <p
                      className={cn(
                        'text-xs',
                        geminiStatus === 'enabled' && 'text-muted-foreground',
                        geminiStatus === 'disabled' && 'text-amber-700',
                        geminiStatus === 'unknown' && 'text-slate-600',
                      )}
                    >
                      {geminiStatus === 'enabled'
                        ? t('dashboard.aiFeedbackEnabledDescription')
                        : geminiStatus === 'disabled'
                          ? t('dashboard.aiFeedbackDisabledDescription')
                          : t('dashboard.aiFeedbackUnknownDescription')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md border-primary/20 bg-primary/5 transition-all duration-700 hover:shadow-lg" style={{ transitionDelay: '420ms' }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-primary">{t('dashboard.nextMilestone')}</CardTitle>
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
          </div>
        </div>
      </div>
    </>
  );
}
