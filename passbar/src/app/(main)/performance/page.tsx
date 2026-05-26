"use client";

import React, { useEffect, useMemo, useState } from 'react';
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
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Target } from 'lucide-react';
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

type PerformanceData = {
  totalAttempts: number;
  correctAttempts: number;
  averageSeconds: number;
  subjectStats: StatBucket[];
  chapterStats: StatBucket[];
  weeklyRows: Array<Record<string, string | number>>;
  weeklySubjects: string[];
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

function buildPerformanceData(
  answers: AnswerRow[],
  metadata: Map<string, QuestionMetaRow>,
  labels: { unknownSubject: string; unknownChapter: string; locale: string },
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
  };
}

export default function PerformanceDetail() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const labels = {
      unknownSubject: t('performance.unknownSubject'),
      unknownChapter: t('performance.unknownChapter'),
      locale: language === 'en' ? 'en-US' : language,
    };

    const loadPerformance = async () => {
      if (!supabase || !user?.id) {
        setData(buildPerformanceData([], new Map(), labels));
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data: answerRows, error } = await supabase
        .from('practice_answers')
        .select('question_id, is_correct, answered_at, time_spent_seconds')
        .eq('user_id', user.id)
        .order('answered_at', { ascending: true })
        .limit(5000);

      if (error) {
        console.warn('[PassBar] Failed to load performance answers:', error.message);
        setData(buildPerformanceData([], new Map(), labels));
        setLoading(false);
        return;
      }

      const answers = (answerRows ?? []) as AnswerRow[];
      const metadata = await getQuestionMetadata(answers.map((answer) => answer.question_id));
      setData(buildPerformanceData(answers, metadata, labels));
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

  if (loading) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-4xl font-bold text-primary">{t('performance.title')}</h1>
          <p className="text-lg text-muted-foreground">{t('performance.loading')}</p>
        </header>
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
    <div className="space-y-6">
      <header>
        <h1 className="text-4xl font-bold text-primary">{t('performance.title')}</h1>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <Target className="h-9 w-9 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">{t('performance.overallAccuracy')}</p>
              <p className="text-3xl font-bold">{overallAccuracy}%</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <CheckCircle2 className="h-9 w-9 text-green-600" />
            <div>
              <p className="text-sm text-muted-foreground">{t('performance.correctTotal')}</p>
              <p className="text-3xl font-bold">{data.correctAttempts} / {data.totalAttempts}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <Clock3 className="h-9 w-9 text-slate-600" />
            <div>
              <p className="text-sm text-muted-foreground">{t('performance.avgTime')}</p>
              <p className="text-3xl font-bold">{formatSeconds(data.averageSeconds)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <Activity className="h-9 w-9 text-sky-600" />
            <div>
              <p className="text-sm text-muted-foreground">{t('performance.subjectsPracticed')}</p>
              <p className="text-3xl font-bold">{data.subjectStats.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
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
                      className="h-full rounded-full"
                      style={{
                        width: `${accuracy}%`,
                        backgroundColor: chartColors[index % chartColors.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('performance.highestYieldReview')}</CardTitle>
            <CardDescription>{t('performance.highestYieldDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {weakChapters.map((chapter) => {
              const accuracy = percent(chapter.correct, chapter.attempts);
              return (
                <div key={chapter.key} className="rounded-md border border-slate-200 p-3">
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

      <Card>
        <CardHeader>
          <CardTitle>{t('performance.questionsOverTime')}</CardTitle>
          <CardDescription>{t('performance.questionsOverTimeDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weeklyRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {data.weeklySubjects.map((subject, index) => (
                  <Bar key={subject} dataKey={subject} fill={chartColors[index % chartColors.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('performance.strongChapters')}</CardTitle>
          <CardDescription>{t('performance.strongChaptersDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {strongChapters.map((chapter) => {
            const accuracy = percent(chapter.correct, chapter.attempts);
            return (
              <div key={chapter.key} className="rounded-md border border-green-100 bg-green-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">{chapter.label}</div>
                  <Badge className="bg-green-600 text-white hover:bg-green-600">{accuracy}%</Badge>
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
