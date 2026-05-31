"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Target, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

type AnswerRow = {
  question_id: string;
  is_correct: boolean;
  answered_at: string | null;
  time_spent_seconds: number | null;
};

type QuestionMetaRow = {
  id: string;
  subject: string;
  chapter_id: string;
  topic: string;
};

type StatBucket = {
  key: string;
  label: string;
  subject?: string;
  attempts: number;
  correct: number;
  seconds: number;
};

type AnswerChanges = {
  correctToIncorrect: number;
  incorrectToCorrect: number;
  incorrectToIncorrect: number;
};

type OverallStats = {
  totalCorrect: number;
  totalIncorrect: number;
  totalOmitted: number;
  answerChanges: AnswerChanges;
  usedQuestions: number;
  unusedQuestions: number;
  totalQuestions: number;
  testsCreated: number;
  testsCompleted: number;
  suspendedTests: number;
};

type PerformanceData = {
  totalAttempts: number;
  correctAttempts: number;
  averageSeconds: number;
  subjectStats: StatBucket[];
  chapterStats: StatBucket[];
  weeklyRows: Array<Record<string, string | number>>;
  weeklySubjects: string[];
  overall: OverallStats;
};

const chartColors = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

function percent(correct: number, attempts: number) {
  return attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
}

function formatSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function weekStart(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function weekKey(date: Date) {
  const start = weekStart(date);
  return start.toISOString().slice(0, 10);
}

function weekLabel(key: string, locale: string) {
  const date = new Date(`${key}T00:00:00`);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function getQuestionMetadata(questionIds: string[]) {
  if (!supabase || questionIds.length === 0) return new Map<string, QuestionMetaRow>();

  const rows: QuestionMetaRow[] = [];
  for (const ids of chunk(Array.from(new Set(questionIds)), 400)) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, subject, chapter_id, topic')
      .in('id', ids);

    if (error) {
      console.warn('[PassBar] Failed to load performance question metadata:', error.message);
      continue;
    }
    rows.push(...((data ?? []) as QuestionMetaRow[]));
  }

  return new Map(rows.map((row) => [row.id, row]));
}

function computeAnswerChanges(answers: AnswerRow[]): AnswerChanges {
  const byQuestion = new Map<string, AnswerRow[]>();
  answers.forEach((answer) => {
    const list = byQuestion.get(answer.question_id) ?? [];
    list.push(answer);
    byQuestion.set(answer.question_id, list);
  });

  let correctToIncorrect = 0;
  let incorrectToCorrect = 0;
  let incorrectToIncorrect = 0;

  byQuestion.forEach((list) => {
    const sorted = [...list].sort((a, b) =>
      (a.answered_at ?? '').localeCompare(b.answered_at ?? ''),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].is_correct;
      const curr = sorted[i].is_correct;
      if (prev && !curr) correctToIncorrect += 1;
      else if (!prev && curr) incorrectToCorrect += 1;
      else if (!prev && !curr) incorrectToIncorrect += 1;
    }
  });

  return { correctToIncorrect, incorrectToCorrect, incorrectToIncorrect };
}

function buildPerformanceData(
  answers: AnswerRow[],
  metadata: Map<string, QuestionMetaRow>,
  labels: { unknownSubject: string; unknownChapter: string; locale: string },
  overall: OverallStats,
): PerformanceData {
  const subjectMap = new Map<string, StatBucket>();
  const chapterMap = new Map<string, StatBucket>();
  const weeklyMap = new Map<string, Record<string, string | number>>();
  let correctAttempts = 0;
  let totalSeconds = 0;

  answers.forEach((answer) => {
    const meta = metadata.get(answer.question_id);
    const subject = meta?.subject ?? labels.unknownSubject;
    const topic = meta?.topic ?? labels.unknownChapter;
    const chapterKey = `${subject}::${meta?.chapter_id ?? topic}`;
    const seconds = answer.time_spent_seconds ?? 0;

    if (answer.is_correct) correctAttempts += 1;
    totalSeconds += seconds;

    const subjectBucket = subjectMap.get(subject) ?? {
      key: subject,
      label: subject,
      attempts: 0,
      correct: 0,
      seconds: 0,
    };
    subjectBucket.attempts += 1;
    subjectBucket.correct += answer.is_correct ? 1 : 0;
    subjectBucket.seconds += seconds;
    subjectMap.set(subject, subjectBucket);

    const chapterBucket = chapterMap.get(chapterKey) ?? {
      key: chapterKey,
      label: topic,
      subject,
      attempts: 0,
      correct: 0,
      seconds: 0,
    };
    chapterBucket.attempts += 1;
    chapterBucket.correct += answer.is_correct ? 1 : 0;
    chapterBucket.seconds += seconds;
    chapterMap.set(chapterKey, chapterBucket);

    const answeredAt = answer.answered_at ? new Date(answer.answered_at) : new Date();
    const key = weekKey(answeredAt);
    const weeklyRow = weeklyMap.get(key) ?? { key, week: weekLabel(key, labels.locale) };
    weeklyRow[subject] = Number(weeklyRow[subject] ?? 0) + 1;
    weeklyMap.set(key, weeklyRow);
  });

  const subjectStats = Array.from(subjectMap.values()).sort((a, b) => b.attempts - a.attempts);
  const chapterStats = Array.from(chapterMap.values()).sort((a, b) => {
    const accuracyDelta = percent(a.correct, a.attempts) - percent(b.correct, b.attempts);
    return accuracyDelta || b.attempts - a.attempts;
  });
  const weeklySubjects = subjectStats.slice(0, 5).map((item) => item.label);
  const weeklyRows = Array.from(weeklyMap.values())
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
    .slice(-8)
    .map((row) => {
      const next = { ...row };
      weeklySubjects.forEach((subject) => {
        next[subject] = Number(next[subject] ?? 0);
      });
      return next;
    });

  return {
    totalAttempts: answers.length,
    correctAttempts,
    averageSeconds: answers.length > 0 ? Math.round(totalSeconds / answers.length) : 0,
    subjectStats,
    chapterStats,
    weeklyRows,
    weeklySubjects,
    overall,
  };
}

function useCountUp(target: number, duration = 900) {
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

function AnimatedStat({ value, delay = 0 }: { value: number; delay?: number }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const count = useCountUp(started ? value : 0);
  return <>{count.toLocaleString()}</>;
}

function DonutChart({
  data,
  label,
  total,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  label: string;
  total: number;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-32">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.filter((d) => d.value > 0)}
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={60}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              isAnimationActive
              animationDuration={1000}
              animationEasing="ease-out"
            >
              {data.filter((d) => d.value > 0).map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(val) => [val, '']} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-slate-800">
            {total > 0 ? `${Math.round((data[0]?.value ?? 0) / total * 100)}%` : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  delay,
  highlight,
}: {
  label: string;
  value: number;
  delay?: number;
  highlight?: 'green' | 'red' | 'none';
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{label}</span>
      <span
        className={cn(
          'inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold',
          highlight === 'green' && 'bg-green-100 text-green-700',
          highlight === 'red' && 'bg-red-100 text-red-700',
          (!highlight || highlight === 'none') && 'bg-slate-100 text-slate-700',
        )}
      >
        <AnimatedStat value={value} delay={delay} />
      </span>
    </div>
  );
}

function OverallPerformanceSection({ overall, t }: { overall: OverallStats; t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0], params?: Record<string, string | number>) => string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const total = overall.totalCorrect + overall.totalIncorrect + overall.totalOmitted;

  const scoreData = [
    { name: 'Correct', value: overall.totalCorrect, color: '#22c55e' },
    { name: 'Incorrect', value: overall.totalIncorrect, color: '#ef4444' },
    { name: 'Omitted', value: overall.totalOmitted, color: '#cbd5e1' },
  ];

  const usageData = [
    { name: 'Used', value: overall.usedQuestions, color: '#3b82f6' },
    { name: 'Unused', value: overall.unusedQuestions, color: '#e2e8f0' },
  ];

  return (
    <div
      className={cn(
        'transition-all duration-700',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
      )}
    >
      <Card className="shadow-md overflow-hidden">
        <CardHeader className="border-b bg-slate-50/60">
          <CardTitle className="text-lg">{t('performance.overallPerformance')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-100">
            {/* Your Score */}
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">{t('performance.yourScore')}</h3>
                <DonutChart data={scoreData} label="Correct" total={total} />
              </div>
              <div>
                <StatRow label={t('performance.totalCorrect')} value={overall.totalCorrect} delay={0} highlight="green" />
                <StatRow label={t('performance.totalIncorrect')} value={overall.totalIncorrect} delay={80} highlight="red" />
                <StatRow label={t('performance.totalOmitted')} value={overall.totalOmitted} delay={160} />
              </div>
            </div>

            {/* Answer Changes */}
            <div className="p-6 flex flex-col gap-4">
              <h3 className="font-semibold text-slate-800">{t('performance.answerChanges')}</h3>
              <div className="flex items-center gap-3 mb-2">
                <TrendingDown className="h-8 w-8 text-red-400" />
                <TrendingUp className="h-8 w-8 text-green-400" />
              </div>
              <div>
                <StatRow label={t('performance.correctToIncorrect')} value={overall.answerChanges.correctToIncorrect} delay={0} highlight="red" />
                <StatRow label={t('performance.incorrectToCorrect')} value={overall.answerChanges.incorrectToCorrect} delay={80} highlight="green" />
                <StatRow label={t('performance.incorrectToIncorrect')} value={overall.answerChanges.incorrectToIncorrect} delay={160} />
              </div>
            </div>

            {/* QBank Usage */}
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">{t('performance.qbankUsage')}</h3>
                <DonutChart data={usageData} label="Used" total={overall.totalQuestions} />
              </div>
              <div>
                <StatRow label={t('performance.usedQuestions')} value={overall.usedQuestions} delay={0} />
                <StatRow label={t('performance.unusedQuestions')} value={overall.unusedQuestions} delay={80} />
                <StatRow label={t('performance.totalQuestions')} value={overall.totalQuestions} delay={160} />
              </div>
            </div>

            {/* Test Count */}
            <div className="p-6 flex flex-col gap-4">
              <h3 className="font-semibold text-slate-800">{t('performance.testCount')}</h3>
              <div className="flex items-center justify-center h-20">
                <div className="text-center">
                  <div className="text-4xl font-bold text-primary">
                    <AnimatedStat value={overall.testsCompleted} delay={0} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{t('performance.testsCompleted')}</div>
                </div>
              </div>
              <div>
                <StatRow label={t('performance.testsCreated')} value={overall.testsCreated} delay={0} />
                <StatRow label={t('performance.testsCompleted')} value={overall.testsCompleted} delay={80} highlight="green" />
                <StatRow label={t('performance.suspendedTests')} value={overall.suspendedTests} delay={160} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PerformanceDetail() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const labels = {
      unknownSubject: t('performance.unknownSubject'),
      unknownChapter: t('performance.unknownChapter'),
      locale: language === 'en' ? 'en-US' : language,
    };

    const loadPerformance = async () => {
      if (!supabase || !user?.id) {
        const emptyOverall: OverallStats = {
          totalCorrect: 0, totalIncorrect: 0, totalOmitted: 0,
          answerChanges: { correctToIncorrect: 0, incorrectToCorrect: 0, incorrectToIncorrect: 0 },
          usedQuestions: 0, unusedQuestions: 0, totalQuestions: 0,
          testsCreated: 0, testsCompleted: 0, suspendedTests: 0,
        };
        setData(buildPerformanceData([], new Map(), labels, emptyOverall));
        setLoading(false);
        return;
      }

      setLoading(true);

      const [answerRowsResult, progressResult, sessionsResult, questionCountResult] = await Promise.all([
        supabase
          .from('practice_answers')
          .select('question_id, is_correct, answered_at, time_spent_seconds')
          .eq('user_id', user.id)
          .order('answered_at', { ascending: true })
          .limit(5000),
        supabase
          .from('user_question_progress')
          .select('status')
          .eq('user_id', user.id),
        supabase
          .from('practice_sessions')
          .select('id, status')
          .eq('user_id', user.id),
        supabase
          .from('question_chapter_counts')
          .select('count'),
      ]);

      if (answerRowsResult.error) {
        console.warn('[PassBar] Failed to load performance answers:', answerRowsResult.error.message);
        const emptyOverall: OverallStats = {
          totalCorrect: 0, totalIncorrect: 0, totalOmitted: 0,
          answerChanges: { correctToIncorrect: 0, incorrectToCorrect: 0, incorrectToIncorrect: 0 },
          usedQuestions: 0, unusedQuestions: 0, totalQuestions: 0,
          testsCreated: 0, testsCompleted: 0, suspendedTests: 0,
        };
        setData(buildPerformanceData([], new Map(), labels, emptyOverall));
        setLoading(false);
        return;
      }

      const answers = (answerRowsResult.data ?? []) as AnswerRow[];
      const progressRows = (progressResult.data ?? []) as Array<{ status: string }>;
      const sessions = (sessionsResult.data ?? []) as Array<{ id: string; status: string }>;
      const questionCounts = (questionCountResult.data ?? []) as Array<{ count: number }>;

      const totalCorrect = progressRows.filter((r) => r.status === 'correct').length;
      const totalIncorrect = progressRows.filter((r) => r.status === 'incorrect').length;
      const totalOmitted = progressRows.filter((r) => r.status === 'omitted').length;
      const usedQuestions = progressRows.filter((r) => r.status !== 'omitted').length;
      const totalQuestions = questionCounts.reduce((sum, r) => sum + (r.count ?? 0), 0);
      const unusedQuestions = Math.max(0, totalQuestions - progressRows.length);

      const testsCreated = sessions.length;
      const testsCompleted = sessions.filter((s) => s.status === 'completed').length;
      const suspendedTests = sessions.filter((s) => s.status === 'suspended').length;

      const overall: OverallStats = {
        totalCorrect,
        totalIncorrect,
        totalOmitted,
        answerChanges: computeAnswerChanges(answers),
        usedQuestions,
        unusedQuestions,
        totalQuestions,
        testsCreated,
        testsCompleted,
        suspendedTests,
      };

      const metadata = await getQuestionMetadata(answers.map((answer) => answer.question_id));
      setData(buildPerformanceData(answers, metadata, labels, overall));
      setLoading(false);
    };

    loadPerformance();
  }, [language, t, user?.id]);

  const weakChapters = useMemo(() => (
    (data?.chapterStats ?? []).filter((chapter) => chapter.attempts >= 1).slice(0, 8)
  ), [data?.chapterStats]);

  const strongChapters = useMemo(() => (
    [...(data?.chapterStats ?? [])]
      .filter((chapter) => chapter.attempts >= 1)
      .sort((a, b) => percent(b.correct, b.attempts) - percent(a.correct, a.attempts) || b.attempts - a.attempts)
      .slice(0, 5)
  ), [data?.chapterStats]);

  const overallAccuracy = data ? percent(data.correctAttempts, data.totalAttempts) : 0;
  const accuracyCount = useCountUp(loading ? 0 : overallAccuracy);

  if (loading) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-4xl font-bold text-primary">{t('performance.title')}</h1>
          <p className="text-lg text-muted-foreground">{t('performance.loading')}</p>
        </header>
        <Card>
          <CardContent className="h-[200px] animate-pulse bg-muted/20" />
        </Card>
        <Card>
          <CardContent className="h-[420px] animate-pulse bg-muted/20" />
        </Card>
      </div>
    );
  }

  if (!data || data.totalAttempts === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-4xl font-bold text-primary">{t('performance.title')}</h1>
          <p className="text-lg text-muted-foreground">{t('performance.description')}</p>
        </header>
        <Card className="border-dashed">
          <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
            <Activity className="h-10 w-10 text-muted-foreground" />
            <div>
              <h2 className="text-2xl font-semibold">{t('performance.noAnswersTitle')}</h2>
              <p className="mt-2 max-w-xl text-muted-foreground">
                {t('performance.noAnswersDescription')}
              </p>
            </div>
            <Button asChild>
              <Link href="/create">{t('performance.startPractice')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'space-y-6 transition-all duration-700',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}
    >
      <header>
        <h1 className="text-4xl font-bold text-primary">{t('performance.title')}</h1>
      </header>

      {/* Overall Performance — UWorld-style summary */}
      <OverallPerformanceSection overall={data.overall} t={t} />

      {/* Summary stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { icon: <Target className="h-9 w-9 text-primary" />, label: t('performance.overallAccuracy'), value: `${accuracyCount}%`, delay: 0 },
          { icon: <CheckCircle2 className="h-9 w-9 text-green-600" />, label: t('performance.correctTotal'), value: `${data.correctAttempts} / ${data.totalAttempts}`, delay: 80 },
          { icon: <Clock3 className="h-9 w-9 text-slate-600" />, label: t('performance.avgTime'), value: formatSeconds(data.averageSeconds), delay: 160 },
          { icon: <Activity className="h-9 w-9 text-primary" />, label: t('performance.subjectsPracticed'), value: String(data.subjectStats.length), delay: 240 },
        ].map((item, i) => (
          <Card
            key={i}
            className="transition-all duration-500 hover:shadow-md hover:-translate-y-0.5"
            style={{ transitionDelay: `${item.delay}ms` }}
          >
            <CardContent className="flex items-center gap-4 p-5">
              {item.icon}
              <div>
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="text-3xl font-bold">{item.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="transition-all duration-500 hover:shadow-md">
          <CardHeader>
            <CardTitle>{t('performance.subjectAccuracy')}</CardTitle>
            <CardDescription>{t('performance.subjectAccuracyDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.subjectStats.map((subject, index) => {
              const accuracy = percent(subject.correct, subject.attempts);
              return (
                <div key={subject.key} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-slate-800">{subject.label}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Badge variant="outline">{subject.correct}/{subject.attempts}</Badge>
                      <span>{accuracy}%</span>
                    </div>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${accuracy}%`,
                        backgroundColor: chartColors[index % chartColors.length],
                        transitionDelay: `${index * 80}ms`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="transition-all duration-500 hover:shadow-md">
          <CardHeader>
            <CardTitle>{t('performance.highestYieldReview')}</CardTitle>
            <CardDescription>{t('performance.highestYieldDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {weakChapters.map((chapter) => {
              const accuracy = percent(chapter.correct, chapter.attempts);
              return (
                <div key={chapter.key} className="rounded-md border border-slate-200 p-3 transition-all duration-300 hover:border-slate-300 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{chapter.label}</div>
                      <div className="text-sm text-muted-foreground">{chapter.subject}</div>
                    </div>
                    <Badge className={cn(
                      'shrink-0',
                      accuracy < 50 ? 'bg-red-100 text-red-700 hover:bg-red-100' : 'bg-amber-100 text-amber-700 hover:bg-amber-100',
                    )}>
                      {accuracy}%
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    {t('performance.correctCount', { correct: chapter.correct, total: chapter.attempts })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="transition-all duration-500 hover:shadow-md">
        <CardHeader>
          <CardTitle>{t('performance.questionsOverTime')}</CardTitle>
          <CardDescription>{t('performance.questionsOverTimeDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[420px] min-w-0 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <BarChart data={data.weeklyRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {data.weeklySubjects.map((subject, index) => (
                  <Bar
                    key={subject}
                    dataKey={subject}
                    fill={chartColors[index % chartColors.length]}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive
                    animationDuration={800}
                    animationEasing="ease-out"
                    animationBegin={index * 100}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="transition-all duration-500 hover:shadow-md">
        <CardHeader>
          <CardTitle>{t('performance.strongChapters')}</CardTitle>
          <CardDescription>{t('performance.strongChaptersDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {strongChapters.map((chapter, i) => {
            const accuracy = percent(chapter.correct, chapter.attempts);
            return (
              <div
                key={chapter.key}
                className="rounded-md border border-green-100 bg-green-50/60 p-4 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">{chapter.label}</div>
                  <Badge className="bg-primary text-primary-foreground hover:bg-primary">{accuracy}%</Badge>
                </div>
                <div className="mt-1 text-sm text-green-800">{chapter.subject}</div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {t('performance.correctCount', { correct: chapter.correct, total: chapter.attempts })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
