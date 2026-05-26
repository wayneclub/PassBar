"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
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
import { useI18n } from '@/lib/i18n';
import { withBasePath } from '@/lib/site';
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

type GeminiStatus = 'enabled' | 'disabled' | 'unknown';

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

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyDashboardData);
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>('unknown');

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
    fetch(withBasePath('/api/gemini-feedback/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })
      .then((response) => response.json())
      .then((data: { enabled?: boolean }) => {
        if (active) setGeminiStatus(data.enabled ? 'enabled' : 'disabled');
      })
      .catch(() => {
        if (active) setGeminiStatus('unknown');
      });

    return () => {
      active = false;
    };
  }, []);

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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary">{t('dashboard.welcome', { name: userFirstName })}</h1>
          <p className="text-muted-foreground mt-1">
            {dashboardData.loading
              ? t('dashboard.loading')
              : dashboardData.solvedQuestions > 0
                ? t('dashboard.answered', { solved: dashboardData.solvedQuestions.toLocaleString(), total: dashboardData.totalQuestions.toLocaleString() })
                : t('dashboard.ready', { total: dashboardData.totalQuestions.toLocaleString() })}
          </p>
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
        <Card className="bg-white/50 border-primary/10 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.overallMastery')}</p>
                <h3 className="text-2xl font-bold mt-1">{formatPercent(dashboardData.mastery)}</h3>
              </div>
              <div className="p-2 bg-primary/10 rounded-full">
                <Trophy className="w-5 h-5 text-primary" />
              </div>
            </div>
            <Progress value={dashboardData.mastery} className="h-1.5 mt-4" />
          </CardContent>
        </Card>

        <Card className="bg-white/50 border-secondary/10 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.questionsSolved')}</p>
                <h3 className="text-2xl font-bold mt-1">
                  {dashboardData.solvedQuestions.toLocaleString()} / {dashboardData.totalQuestions.toLocaleString()}
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

        <Card className="bg-white/50 border-orange-100 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.studyStreak')}</p>
                <h3 className="text-2xl font-bold mt-1">{dashboardData.streakDays} {t('dashboard.days')}</h3>
              </div>
              <div className="p-2 bg-orange-50 rounded-full">
                <Flame className="w-5 h-5 text-orange-500" />
              </div>
            </div>
            <div className="flex gap-1 mt-4">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <div
                  key={day}
                  className={cn('flex-1 h-1.5 rounded-full', day <= dashboardData.streakDays ? 'bg-orange-500' : 'bg-muted')}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/50 border-blue-100 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('dashboard.timeToday')}</p>
                <h3 className="text-2xl font-bold mt-1">{formatDuration(dashboardData.timeTodaySeconds)}</h3>
              </div>
              <div className="p-2 bg-blue-50 rounded-full">
                <Clock className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">{t('dashboard.remaining', { count: remainingQuestions.toLocaleString() })}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 shadow-md">
          <CardHeader>
            <CardTitle>{t('dashboard.subjectPerformance')}</CardTitle>
            <CardDescription>{t('dashboard.subjectPerformanceDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardData.subjectPerformance.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
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
                    <Bar dataKey="score" radius={[4, 4, 0, 0]}>
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
          <Card className="shadow-md">
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
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <BookOpen className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-blue-900">{t('dashboard.noAnswers')}</p>
                    <p className="text-xs text-blue-700">{t('dashboard.noAnswersDescription')}</p>
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
                  geminiStatus === 'enabled' && 'border-sky-100 bg-sky-50',
                  geminiStatus === 'disabled' && 'border-amber-100 bg-amber-50',
                  geminiStatus === 'unknown' && 'border-slate-200 bg-slate-50',
                )}
              >
                <Sparkles
                  className={cn(
                    'mt-0.5 h-5 w-5',
                    geminiStatus === 'enabled' && 'text-sky-600',
                    geminiStatus === 'disabled' && 'text-amber-600',
                    geminiStatus === 'unknown' && 'text-slate-500',
                  )}
                />
                <div>
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      geminiStatus === 'enabled' && 'text-sky-900',
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
                      geminiStatus === 'enabled' && 'text-sky-700',
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

          <Card className="shadow-md border-primary/20 bg-primary/5">
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
  );
}
