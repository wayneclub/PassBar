"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { requestPerformanceDiagnosis } from '@/lib/gemini-feedback';
import {
  Bar,
  BarChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,

  Flame,
  Loader2,
  Map as MapIcon,
  Play,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

// ─── Types ─────────────────────────────────────────────────────────────────

type AnswerRow = {
  question_id: string;
  is_correct: boolean;
  answered_at: string | null;
  time_spent_seconds: number | null;
  confidence: string | null;
  changed_answer: boolean | null;
  error_type: string | null;
  selected_choice: string | null;
  correct_answer: string | null;
};

type KeywordItem = {
  id: string;
  text: string;
  label?: { en?: string; zh?: string };
  kind: string;
  reason?: { en?: string; zh?: string };
  importance?: string;
};

type KeywordMeta = {
  question_keyword_meta?: { keywords: KeywordItem[] };
  choice_keyword_meta?: { choices: Partial<Record<'A' | 'B' | 'C' | 'D', KeywordItem[]>> };
};

type HighlightItem = {
  id: string;
  text: string;
  kind: string;
  label?: { en?: string; zh?: string };
  reason?: { en?: string; zh?: string };
  importance?: string;
};

type HighlightMeta = {
  question_highlight_meta?: { highlights: HighlightItem[] };
};

type QuestionMetaRow = {
  id: string;
  subject: string;
  chapter_id: string;
  chapter_name: string;
  topic: string | null;
  micro_concept: string | null;
  trap_type: string | null;
  trap_type_is_new: boolean | null;
  skill_tested: string | null;
  keyword_meta: KeywordMeta | null;
  highlight_meta: HighlightMeta | null;
};

type ConceptMasteryRow = {
  subject: string;
  topic: string;
  micro_concept: string;
  attempts: number;
  correct: number;
  status: string;
  last_attempt_at: string | null;
};

type DiagnosisResult = {
  diagnosis: string;
  topPriorities: Array<{ concept: string; subject: string; reason: string; suggestedMinutes: number }>;
  studyPlan: Array<{ step: number; action: string; duration: string }>;
  encouragement: string;
  readinessScore: number;
};

type PageData = {
  answers: AnswerRow[];
  metadata: Map<string, QuestionMetaRow>;
  conceptMastery: ConceptMasteryRow[];
  totalAttempts: number;
  correctAttempts: number;
  avgTimeSeconds: number;
  streakDays: number;
  errorTypeBreakdown: Record<string, number>;
  recentTrend: number[];
  weakConcepts: Array<{ concept: string; subject: string; topic: string; attempts: number; correct: number; avgTime: number }>;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function pct(correct: number, attempts: number) {
  return attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function computeStreakDays(answers: AnswerRow[]): number {
  if (answers.length === 0) return 0;
  const days = new Set(
    answers.filter((a) => a.answered_at).map((a) => a.answered_at!.slice(0, 10)),
  );
  const today = new Date().toISOString().slice(0, 10);
  let streak = 0;
  let cursor = new Date(today);
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function computeRecentTrend(answers: AnswerRow[]): number[] {
  if (answers.length === 0) return [];
  const dayMap = new Map<string, { correct: number; total: number }>();
  answers.forEach((a) => {
    if (!a.answered_at) return;
    const day = a.answered_at.slice(0, 10);
    const bucket = dayMap.get(day) ?? { correct: 0, total: 0 };
    bucket.total++;
    if (a.is_correct) bucket.correct++;
    dayMap.set(day, bucket);
  });
  const sorted = ([...dayMap.entries()] as [string, { correct: number; total: number }][])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-10);
  return sorted.map(([, v]) => Math.round((v.correct / v.total) * 100));
}

// Approximate MBE-equivalent scaled-score passing lines by jurisdiction.
// Falls back to the UBE national median (133, used by NY and most UBE states)
// when the user hasn't set a jurisdiction or picked one we don't have a cut score for.
const PASSING_SCORES: Record<string, { score: number; label: string }> = {
  ny: { score: 133, label: 'NY' },
  ca: { score: 135, label: 'CA' },
};
const DEFAULT_PASSING = { score: 133, label: 'UBE' };

function getPassingStandard(examState: string | null): { score: number; label: string } {
  if (!examState) return DEFAULT_PASSING;
  return PASSING_SCORES[examState] ?? { ...DEFAULT_PASSING, label: examState.toUpperCase() };
}

function pickLang(text: { en?: string; zh?: string } | undefined, language: string): string {
  if (!text) return '';
  const key = language === 'en' ? 'en' : 'zh';
  return text[key] ?? text.en ?? text.zh ?? '';
}

function pickHighImportance<T extends { importance?: string; kind?: string }>(
  items: T[] | undefined,
  preferredKinds: string[] = [],
): T | null {
  if (!items || items.length === 0) return null;
  const byPreferredKind = preferredKinds.length > 0
    ? items.find((item) => preferredKinds.includes(item.kind ?? '') && item.importance === 'high')
    : null;
  if (byPreferredKind) return byPreferredKind;
  const preferred = preferredKinds.length > 0
    ? items.find((item) => preferredKinds.includes(item.kind ?? ''))
    : null;
  if (preferred) return preferred;
  return items.find((item) => item.importance === 'high') ?? items[0];
}

type FatigueBucket = { group: string; focus: number; expectedErrors: number; avgTime: number; sampleSize: number };

const FATIGUE_SESSION_GAP_MS = 20 * 60 * 1000;
const FATIGUE_MIN_SESSION_SIZE = 8;

function computeFatigueData(answers: AnswerRow[]): { buckets: FatigueBucket[]; sessionCount: number } {
  const timed = answers
    .filter((a) => a.answered_at)
    .slice()
    .sort((a, b) => (a.answered_at ?? '').localeCompare(b.answered_at ?? ''));
  if (timed.length === 0) return { buckets: [], sessionCount: 0 };

  const sessions: AnswerRow[][] = [];
  let current: AnswerRow[] = [];
  let lastTime: number | null = null;
  timed.forEach((a) => {
    const time = new Date(a.answered_at!).getTime();
    if (lastTime !== null && time - lastTime > FATIGUE_SESSION_GAP_MS) {
      if (current.length > 0) sessions.push(current);
      current = [];
    }
    current.push(a);
    lastTime = time;
  });
  if (current.length > 0) sessions.push(current);

  const longSessions = sessions.filter((s) => s.length >= FATIGUE_MIN_SESSION_SIZE);
  if (longSessions.length === 0) return { buckets: [], sessionCount: 0 };

  const totals = [0, 1, 2, 3].map(() => ({ correct: 0, total: 0, time: 0 }));
  longSessions.forEach((session) => {
    session.forEach((a, i) => {
      const bucketIdx = Math.min(3, Math.floor((i / session.length) * 4));
      totals[bucketIdx].total++;
      if (a.is_correct) totals[bucketIdx].correct++;
      totals[bucketIdx].time += a.time_spent_seconds ?? 0;
    });
  });

  const groups = ['performance.fatigueQ1', 'performance.fatigueQ2', 'performance.fatigueQ3', 'performance.fatigueQ4'];
  const buckets = totals.map((b, i) => ({
    group: groups[i],
    focus: b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0,
    expectedErrors: b.total > 0 ? Math.round(((b.total - b.correct) / b.total) * 100) : 0,
    avgTime: b.total > 0 ? Math.round(b.time / b.total) : 0,
    sampleSize: b.total,
  }));

  return { buckets, sessionCount: longSessions.length };
}

function computeErrorTypeBreakdown(answers: AnswerRow[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  answers.forEach((a) => {
    if (!a.is_correct) {
      let type = a.error_type ?? '';
      if (!type) {
        if (a.changed_answer) type = 'Changed Correct to Wrong';
        else if ((a.time_spent_seconds ?? 999) < 30) type = 'Time Pressure Guess';
        else type = 'Unknown';
      }
      breakdown[type] = (breakdown[type] ?? 0) + 1;
    }
  });
  return breakdown;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted/30', className)} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

// ─── Readiness Gauge ─────────────────────────────────────────────────────────

function ReadinessGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 54;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const color = clamped >= 75 ? '#22c55e' : clamped >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="80" viewBox="0 0 140 80">
        <path
          d="M 14 70 A 56 56 0 0 1 126 70"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 14 70 A 56 56 0 0 1 126 70"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <text x="70" y="62" textAnchor="middle" fontSize="22" fontWeight="bold" fill={color}>
          {clamped}
        </text>
        <text x="70" y="76" textAnchor="middle" fontSize="10" fill="#94a3b8">
          / 100
        </text>
      </svg>
    </div>
  );
}

// ─── Tab 1: Prescription ─────────────────────────────────────────────────────

type PrescriptionTask = {
  urgency: 'urgent' | 'mindset' | 'routine';
  subject: string;
  topic: string;
  description: string;
  estimatedMinutes: number;
  questionCount: number;
  href: string;
  actionType: 'execute' | 'review';
};

function buildPrescriptionTasks(data: PageData, t: ReturnType<typeof useI18n>['t']): PrescriptionTask[] {
  const tasks: PrescriptionTask[] = [];

  // Task 1: weakest chapter
  if (data.weakConcepts.length > 0) {
    const weakest = data.weakConcepts[0];
    tasks.push({
      urgency: 'urgent',
      subject: weakest.subject,
      topic: weakest.concept,
      description: t('performance.taskWeakConceptDescription', { pct: pct(weakest.correct, weakest.attempts) }),
      estimatedMinutes: 20,
      questionCount: 10,
      href: '/create',
      actionType: 'execute',
    });
  }

  // Task 2: changed_answer (mindset)
  const changedCount = data.answers.filter((a) => a.changed_answer).length;
  if (changedCount > 0) {
    tasks.push({
      urgency: 'mindset',
      subject: t('performance.mindsetTraining'),
      topic: t('performance.changedAnswerReview'),
      description: t('performance.taskChangedAnswerDescription', { count: changedCount }),
      estimatedMinutes: 15,
      questionCount: changedCount,
      href: '/create',
      actionType: 'review',
    });
  }

  // Task 3: low-sample subject
  const subjectMap = new Map<string, { attempts: number; correct: number }>();
  data.answers.forEach((a) => {
    const meta = data.metadata.get(a.question_id);
    if (!meta) return;
    const s = subjectMap.get(meta.subject) ?? { attempts: 0, correct: 0 };
    s.attempts++;
    if (a.is_correct) s.correct++;
    subjectMap.set(meta.subject, s);
  });
  const lowSampleSubject = [...subjectMap.entries()]
    .filter(([, v]) => v.attempts < 10)
    .sort((a, b) => a[1].attempts - b[1].attempts)[0];
  if (lowSampleSubject) {
    tasks.push({
      urgency: 'routine',
      subject: lowSampleSubject[0],
      topic: t('performance.routinePractice'),
      description: t('performance.taskLowSampleDescription', { subject: lowSampleSubject[0], count: lowSampleSubject[1].attempts }),
      estimatedMinutes: 25,
      questionCount: 15,
      href: '/create',
      actionType: 'execute',
    });
  }

  return tasks;
}

/** 今天的診斷只顯示 HH:mm，較舊的加上月/日，避免誤以為是今天生成的。 */
function formatDiagnosisTime(date: Date): string {
  const hhmm = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? hhmm : `${date.getMonth() + 1}/${date.getDate()} ${hhmm}`;
}

function PrescriptionTab({
  data,
  t,
  language,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
  language: string;
}) {
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  // 還原上次生成並存在 DB 的診斷，重新整理頁面後結果不會消失
  useEffect(() => {
    let active = true;
    api
      .get<{ payload: DiagnosisResult | null; createdAt?: string }>('/gemini-feedback/latest-diagnosis')
      .then((saved) => {
        if (!active || !saved?.payload) return;
        setDiagnosis((current) => current ?? saved.payload);
        if (saved.createdAt) setUpdatedAt(formatDiagnosisTime(new Date(saved.createdAt)));
      })
      .catch(() => {
        // 讀不到舊診斷不影響頁面，僅代表尚未生成過
      });
    return () => {
      active = false;
    };
  }, []);

  const generateDiagnosis = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const raw = await requestPerformanceDiagnosis({
        interfaceLanguage: language,
        performanceStats: {
          totalAttempts: data.totalAttempts,
          correctAttempts: data.correctAttempts,
          avgTimeSeconds: data.avgTimeSeconds,
          weakConcepts: data.weakConcepts,
          errorTypeBreakdown: data.errorTypeBreakdown,
          recentTrend: data.recentTrend,
          streakDays: data.streakDays,
        },
      });
      // 模型偶爾會在 JSON 前後夾帶開場白或 markdown 圍欄，直接擷取最外層 {...} 再解析
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const cleaned = start >= 0 && end > start ? raw.slice(start, end + 1) : raw.trim();
      const parsed = JSON.parse(cleaned) as DiagnosisResult;
      setDiagnosis(parsed);
      setUpdatedAt(formatDiagnosisTime(new Date()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generating diagnosis');
    } finally {
      setLoading(false);
    }
  }, [data, language]);

  const tasks = useMemo(() => buildPrescriptionTasks(data, t), [data, t]);
  const overallAccuracy = pct(data.correctAttempts, data.totalAttempts);
  const energyLevel = overallAccuracy >= 70 ? t('performance.energyHigh') : overallAccuracy >= 50 ? t('performance.energyStable') : t('performance.energyNeedsWork');
  const energyPct = overallAccuracy;

  const urgencyConfig = {
    urgent: { label: t('performance.urgentBreakthrough'), className: 'bg-red-100 text-red-700 border-red-200' },
    mindset: { label: t('performance.mindsetDesensitize'), className: 'bg-blue-100 text-blue-700 border-blue-200' },
    routine: { label: t('performance.routineConsolidate'), className: 'bg-green-100 text-green-700 border-green-200' },
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* AI Diagnosis Card */}
      <Card className="hover:shadow-md transition border-primary/20">
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row gap-0">
            {/* Left panel */}
            <div className="flex flex-col items-center justify-center gap-2 p-5 bg-primary/5 rounded-t-lg md:rounded-l-lg md:rounded-tr-none md:w-48 shrink-0 border-b md:border-b-0 md:border-r border-primary/10">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Brain className="h-6 w-6 text-primary" />
              </div>
              <p className="text-xs font-semibold text-primary text-center">{t('performance.aiSmartAnalysis')}</p>
              {updatedAt && (
                <p className="text-xs text-muted-foreground text-center">
                  {t('performance.aiUpdatedAt', { time: updatedAt })}
                </p>
              )}
              <Button
                onClick={generateDiagnosis}
                disabled={loading || data.totalAttempts === 0}
                size="sm"
                className="mt-2 w-full gap-1 text-xs"
              >
                {loading ? (
                  <><Loader2 className="h-3 w-3 animate-spin" />{t('performance.analyzing')}</>
                ) : (
                  <><Sparkles className="h-3 w-3" />{t('performance.generateDiagnosis')}</>
                )}
              </Button>
            </div>

            {/* Right panel */}
            <div className="flex-1 p-5">
              {!diagnosis && !loading && !error && (
                <div className="flex flex-col items-center justify-center h-full gap-2 py-6 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {data.totalAttempts < 5
                      ? t('performance.sampleTooSmall', { count: data.totalAttempts })
                      : t('performance.diagnosisReady')}
                  </p>
                </div>
              )}
              {loading && (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-6 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">{t('performance.diagnosisLoading')}</p>
                </div>
              )}
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
              )}
              {diagnosis && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-sm font-semibold text-slate-700">
                      {t('performance.diagnosisSummary')}<span className="text-primary">{diagnosis.encouragement}</span>
                    </p>
                    <Badge className="bg-green-100 text-green-700 border-green-200">
                      {energyLevel} {energyPct}%
                    </Badge>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="rounded-lg bg-slate-50 border p-4">
                      <p className="text-xs font-semibold text-primary mb-2 flex items-center gap-1">
                        <Search className="h-3 w-3" />
                        {t('performance.discoveryLabel')}
                      </p>
                      <p className="text-sm text-slate-700 leading-relaxed">{diagnosis.diagnosis}</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-4">
                      <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1">
                        <Target className="h-3 w-3" />
                        {t('performance.mindsetLabel')}
                      </p>
                      {diagnosis.topPriorities.slice(0, 2).map((p, i) => (
                        <p key={i} className="text-sm text-blue-800 mb-1">
                          <span className="font-medium text-primary">{p.concept}</span>: {p.reason}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Task List */}
      <div>
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-4">
          <BookOpen className="h-4 w-4 text-primary" />
          {t('performance.taskListTitle')}
        </h2>

        {tasks.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center py-10 gap-3 text-center">
              <Activity className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('performance.noDataYet')}</p>
              <Button asChild size="sm">
                <Link href="/create">{t('performance.startPractice')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, i) => {
              const cfg = urgencyConfig[task.urgency];
              return (
                <Card key={i} className="hover:shadow-md transition">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex sm:flex-col items-center sm:items-start justify-between sm:justify-start gap-2 w-full sm:w-auto shrink-0 border-b sm:border-b-0 pb-2 sm:pb-0">
                        <Badge className={cn('text-xs border', cfg.className)}>{cfg.label}</Badge>
                        <span className="text-xs text-muted-foreground">{t('performance.estimatedMinutes', { minutes: task.estimatedMinutes })}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900">
                          {task.subject} · {task.topic}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">{task.description}</p>
                      </div>
                      <div className="w-full sm:w-auto shrink-0 pt-2 sm:pt-0 flex justify-end">
                        <Button asChild size="sm" className="w-full sm:w-auto gap-1">
                          <Link href={task.href}>
                            <Play className="h-3 w-3" />
                            {task.actionType === 'execute'
                              ? t('performance.executeRx', { count: task.questionCount })
                              : t('performance.reviewChanged', { count: task.questionCount })}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: Concept Map ───────────────────────────────────────────────────────

type ConceptEntry = {
  concept: string;
  subject: string;
  topic: string;
  attempts: number;
  correct: number;
  avgTime: number;
  status: string;
};

function ConceptMapTab({
  data,
  t,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const [activeSubject, setActiveSubject] = useState<string>('');
  const [selectedPhase, setSelectedPhase] = useState<ConceptEntry | null>(null);

  const conceptEntries = useMemo<ConceptEntry[]>(() => {
    if (data.conceptMastery.length > 0) {
      return data.conceptMastery.map((row) => ({
        concept: row.micro_concept,
        subject: row.subject,
        topic: row.topic,
        attempts: row.attempts,
        correct: row.correct,
        avgTime: 0,
        status: row.status,
      }));
    }
    const map = new Map<string, ConceptEntry>();
    data.answers.forEach((a) => {
      const meta = data.metadata.get(a.question_id);
      if (!meta) return;
      const key = `${meta.subject}::${meta.chapter_name}::${meta.micro_concept ?? meta.chapter_name}`;
      const entry = map.get(key) ?? {
        concept: meta.micro_concept ?? meta.chapter_name,
        subject: meta.subject,
        topic: meta.chapter_name,
        attempts: 0,
        correct: 0,
        avgTime: 0,
        status: 'under-sampled',
      };
      entry.attempts++;
      if (a.is_correct) entry.correct++;
      entry.avgTime = (entry.avgTime * (entry.attempts - 1) + (a.time_spent_seconds ?? 0)) / entry.attempts;
      const acc = pct(entry.correct, entry.attempts);
      entry.status = entry.attempts < 3 ? 'under-sampled' : acc >= 80 ? 'mastered' : acc >= 65 ? 'stabilizing' : acc >= 50 ? 'repairing' : 'struggling';
      map.set(key, entry);
    });
    return [...map.values()] as ConceptEntry[];
  }, [data]);

  const subjects = useMemo(() => {
    return [...new Set(conceptEntries.map((e) => e.subject))];
  }, [conceptEntries]);

  useEffect(() => {
    if (subjects.length > 0 && !activeSubject) {
      setActiveSubject(subjects[0]);
    }
  }, [subjects, activeSubject]);

  const filteredConcepts = useMemo(() => {
    if (!activeSubject) return conceptEntries;
    return conceptEntries.filter((e) => e.subject === activeSubject);
  }, [conceptEntries, activeSubject]);

  const weakestPhase = useMemo(() => {
    return filteredConcepts.filter((c) => c.attempts > 0)
      .sort((a, b) => pct(a.correct, a.attempts) - pct(b.correct, b.attempts))[0] ?? null;
  }, [filteredConcepts]);

  useEffect(() => {
    if (weakestPhase) setSelectedPhase(weakestPhase);
  }, [weakestPhase]);

  if (conceptEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <MapIcon className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t('performance.noDataYet')}</p>
      </div>
    );
  }

  const accColor = (accuracy: number) =>
    accuracy >= 70 ? 'text-green-600' : accuracy >= 40 ? 'text-amber-600' : 'text-red-600';

  const accBgBar = (accuracy: number) =>
    accuracy >= 70 ? 'bg-green-500' : accuracy >= 40 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-4 animate-in fade-in duration-500 w-full min-w-0">
      {/* Subject filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {subjects.map((subj) => (
          <button
            key={subj}
            onClick={() => setActiveSubject(subj)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition',
              activeSubject === subj
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-white text-slate-600 border-border hover:border-primary hover:text-primary',
            )}
          >
            {subj}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4 w-full min-w-0">
        {/* Left: Phase list */}
        <Card className="hover:shadow-md transition w-full min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-primary uppercase tracking-wide">
              {t('performance.phaseView')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0 pr-2 sm:pr-2 space-y-2 max-h-[500px] overflow-y-auto">
            {filteredConcepts.map((c, i) => {
              const accuracy = pct(c.correct, c.attempts);
              const isSelected = selectedPhase?.concept === c.concept;
              return (
                <button
                  key={i}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition min-w-0',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-white hover:border-primary/40',
                  )}
                  onClick={() => setSelectedPhase(c)}
                >
                  <div className="flex items-start justify-between gap-2 mb-1 min-w-0">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold text-primary uppercase">PHASE {i + 1}</span>
                      <p className="text-sm font-semibold text-slate-800 truncate">{c.concept}</p>
                    </div>
                    {c.attempts === 0 ? (
                      <Badge variant="outline" className="text-xs text-slate-400 shrink-0">
                        {t('performance.notActivated')}
                      </Badge>
                    ) : (
                      <span className={cn('text-sm font-bold shrink-0', accColor(accuracy))}>
                        {accuracy}%
                      </span>
                    )}
                  </div>
                  {c.attempts > 0 && (
                    <div className="mt-1">
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', accBgBar(accuracy))}
                          style={{ width: `${accuracy}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('performance.questionsAttempted', { count: c.attempts })}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Right: BLL Focus Info */}
        {selectedPhase && (
          <Card className="hover:shadow-md transition border-primary/20 w-full min-w-0">
            <CardContent className="p-5 space-y-4">
              <p className="text-xs font-bold text-primary uppercase tracking-widest">
                {t('performance.bllFocusInfo')}
              </p>
              <h3 className="text-xl font-bold text-slate-900 break-words">{selectedPhase.concept}</h3>
              <p className="text-sm text-slate-600">
                {selectedPhase.attempts === 0
                  ? t('performance.conceptNotPracticed')
                  : t(
                      pct(selectedPhase.correct, selectedPhase.attempts) < 50
                        ? 'performance.conceptAccuracyNeedsWork'
                        : 'performance.conceptAccuracyKeepGoing',
                      { pct: pct(selectedPhase.correct, selectedPhase.attempts), count: selectedPhase.attempts },
                    )}
              </p>
              <div className="rounded-lg bg-slate-50 border p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{t('performance.blackLetterLaw')}</p>
                <p className="text-sm text-slate-700 italic break-words">
                  {selectedPhase.topic} — {selectedPhase.concept}
                </p>
              </div>
              <Button asChild className="w-full gap-2">
                <Link href="/create">
                  <BookOpen className="h-4 w-4" />
                  {t('performance.createFocusDrill')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Tab 3: Error & Trap Insights ────────────────────────────────────────────

function ErrorTrapTab({
  data,
  t,
  language,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
  language: string;
}) {
  const totalErrors = useMemo(
    () => Object.values(data.errorTypeBreakdown).reduce((s, v) => s + v, 0),
    [data.errorTypeBreakdown],
  );

  const changedCount = useMemo(
    () => data.answers.filter((a) => a.changed_answer).length,
    [data.answers],
  );

  const overthinkingScore = useMemo(() => {
    if (data.totalAttempts === 0) return 0;
    return Math.min(5, Math.round((changedCount / data.totalAttempts) * 5 * 10) / 10);
  }, [changedCount, data.totalAttempts]);

  const overthinkingBadge =
    overthinkingScore >= 3 ? t('performance.overthinkingSevere') : overthinkingScore >= 1.5 ? t('performance.overthinkingModerate') : t('performance.overthinkingMild');
  const overthinkingBadgeClass =
    overthinkingScore >= 3
      ? 'bg-red-100 text-red-700'
      : overthinkingScore >= 1.5
      ? 'bg-amber-100 text-amber-700'
      : 'bg-green-100 text-green-700';

  // Compute 3 error categories
  const bllVague = Math.round(
    (Object.entries(data.errorTypeBreakdown)
      .filter(([k]) => k.includes('Rule') || k.includes('Exception') || k === 'Unknown')
      .reduce((s, [, v]) => s + v, 0) /
      Math.max(1, totalErrors)) *
      100,
  );
  const distractorPct = Math.round(
    ((data.errorTypeBreakdown['Distractor Trap'] ?? 0) / Math.max(1, totalErrors)) * 100,
  );
  const changedPct = Math.round((changedCount / Math.max(1, data.totalAttempts)) * 100);

  const wrongAnswers = useMemo(
    () => data.answers
      .filter((a) => !a.is_correct)
      .sort((a, b) => (b.answered_at ?? '').localeCompare(a.answered_at ?? '')),
    [data.answers],
  );

  // Most recurring trap_type among wrong answers, used to pick a representative
  // question for the Trap Dissection card (falls back to the most recent wrong answer).
  const recurringTrap = useMemo(() => {
    const counts = new Map<string, number>();
    wrongAnswers.forEach((a) => {
      const trap = data.metadata.get(a.question_id)?.trap_type;
      if (trap) counts.set(trap, (counts.get(trap) ?? 0) + 1);
    });
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    return top && top[1] > 1 ? { trap: top[0], count: top[1] } : null;
  }, [wrongAnswers, data.metadata]);

  const mostRecentWrong = useMemo(() => {
    if (recurringTrap) {
      const match = wrongAnswers.find((a) => data.metadata.get(a.question_id)?.trap_type === recurringTrap.trap);
      if (match) return match;
    }
    return wrongAnswers[0] ?? null;
  }, [wrongAnswers, recurringTrap, data.metadata]);

  const wrongMeta = mostRecentWrong ? data.metadata.get(mostRecentWrong.question_id) : null;

  // Richer keyword/highlight metadata for the dissected question, when available
  const selectedChoice = mostRecentWrong?.selected_choice?.toUpperCase() as 'A' | 'B' | 'C' | 'D' | undefined;
  const correctChoice = mostRecentWrong?.correct_answer?.toUpperCase() as 'A' | 'B' | 'C' | 'D' | undefined;
  const wrongChoiceKeyword = pickHighImportance(
    selectedChoice ? wrongMeta?.keyword_meta?.choice_keyword_meta?.choices?.[selectedChoice] : undefined,
    ['trap_phrase'],
  );
  const correctChoiceKeyword = pickHighImportance(
    correctChoice ? wrongMeta?.keyword_meta?.choice_keyword_meta?.choices?.[correctChoice] : undefined,
    ['legal_term'],
  );
  const keyHighlights = (wrongMeta?.highlight_meta?.question_highlight_meta?.highlights ?? [])
    .filter((h) => h.importance === 'high')
    .slice(0, 2);

  if (totalErrors === 0 && changedCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <CheckCircle2 className="h-10 w-10 text-green-400" />
        <p className="text-muted-foreground">{t('performance.noDataYet')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Top two columns */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Left: Error Origin Model */}
        <Card className="hover:shadow-md transition">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              {t('performance.errorOriginTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              {
                label: t('performance.errorBllVagueLabel'),
                pct: bllVague,
                color: 'bg-red-500',
                desc: t('performance.errorBllVagueDescription'),
              },
              {
                label: t('performance.errorDistractorLabel'),
                pct: distractorPct,
                color: 'bg-amber-500',
                desc: t('performance.errorDistractorDescription'),
              },
              {
                label: t('performance.errorOverthinkingLabel'),
                pct: changedPct,
                color: 'bg-blue-500',
                desc: t('performance.errorOverthinkingDescription', { count: changedCount }),
              },
            ].map((cat, i) => (
              <div key={i}>
                <p className="text-sm font-semibold text-slate-700 mb-1">{cat.label}</p>
                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden mb-1">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700', cat.color)}
                    style={{ width: `${cat.pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{cat.desc}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Right: Overthinking Index */}
        <Card className="hover:shadow-md transition border-blue-100">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-blue-500" />
              {t('performance.overthinkingIndex')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl font-bold text-blue-600">{overthinkingScore.toFixed(1)}</span>
              <div>
                <p className="text-sm text-slate-500">/ 5.0</p>
                <Badge className={cn('text-xs mt-1', overthinkingBadgeClass)}>{overthinkingBadge}</Badge>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              {t('performance.overthinkingSummaryPrefix')} <strong className="text-blue-700">{t('performance.questionCount', { count: changedCount })}</strong> {t('performance.overthinkingSummarySuffix')}
            </p>
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
              <p className="text-xs text-blue-700 italic">
                &ldquo;First instinct is usually your best ally on the Bar Exam.&rdquo;
              </p>
            </div>
            <Progress value={(overthinkingScore / 5) * 100} className="h-2" />
          </CardContent>
        </Card>
      </div>

      {/* Trap Dissection */}
      <Card className="hover:shadow-md transition">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-amber-500" />
              {t('performance.trapDissection')}
            </CardTitle>
            {wrongMeta && (
              <span className="text-xs text-muted-foreground">
                {t('performance.sourceLabel')}: {wrongMeta.subject} · {wrongMeta.chapter_name}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!mostRecentWrong || !wrongMeta ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t('performance.noDataYet')}</p>
          ) : (
            <>
              {recurringTrap && (
                <Badge className="bg-amber-100 text-amber-700 border-amber-300">
                  {t('performance.recurringTrapLabel', { trap: recurringTrap.trap, count: recurringTrap.count })}
                </Badge>
              )}
              <div className="rounded-lg border bg-amber-50 border-amber-100 p-4">
                <p className="text-xs font-bold text-amber-700 mb-2">{t('performance.trapScenarioTitle')}</p>
                <p className="text-sm text-slate-700">
                  {t('performance.inConceptPrefix')} <strong>{wrongMeta.subject}</strong> · <strong>{wrongMeta.topic ?? wrongMeta.chapter_name}</strong>:
                  {wrongMeta.trap_type
                    ? t('performance.trapTypeEncountered', { trap: wrongMeta.trap_type })
                    : t('performance.trapUnknownDescription')}
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-bold text-red-600 mb-2">{t('performance.wrongChoiceTrap')}</p>
                  <p className="text-sm text-red-800 font-medium mb-2">
                    {pickLang(wrongChoiceKeyword?.label, language) || wrongMeta.trap_type || t('performance.distractorOption')}
                  </p>
                  <p className="text-xs text-red-600 flex items-start gap-1">
                    <span className="font-bold shrink-0">{t('performance.trapLocation')}</span>
                    <span>
                      {pickLang(wrongChoiceKeyword?.reason, language)
                        || (wrongMeta.trap_type
                          ? t('performance.trapNeedsRuleMemory', { trap: wrongMeta.trap_type })
                          : t('performance.trapNeedsBasicMemory'))}
                    </span>
                  </p>
                </div>
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <p className="text-xs font-bold text-green-600 mb-2">{t('performance.correctAnswerShouldBe')}</p>
                  <p className="text-sm text-green-800 font-medium mb-2">
                    {pickLang(correctChoiceKeyword?.label, language) || wrongMeta.micro_concept || wrongMeta.chapter_name}
                  </p>
                  <p className="text-xs text-green-600 flex items-start gap-1">
                    <span className="font-bold shrink-0">{t('performance.keyConcept')}</span>
                    <span>
                      {pickLang(correctChoiceKeyword?.reason, language)
                        || wrongMeta.skill_tested
                        || t('performance.masterCorePrinciple', { topic: wrongMeta.chapter_name })}
                    </span>
                  </p>
                </div>
              </div>
              {keyHighlights.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-600 mb-2">{t('performance.keySentencesTitle')}</p>
                  <ul className="space-y-2">
                    {keyHighlights.map((h) => (
                      <li key={h.id} className="text-sm text-slate-700">
                        <span className="italic">&ldquo;{h.text}&rdquo;</span>
                        {pickLang(h.reason, language) && (
                          <span className="block text-xs text-slate-500 mt-0.5">{pickLang(h.reason, language)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab 4: Progress & Readiness ──────────────────────────────────────────────

type SubjectSliderState = {
  subject: string;
  currentAccuracy: number;
  sliderValue: number;
};

function ProgressTab({
  data,
  t,
  passingStandard,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
  passingStandard: { score: number; label: string };
}) {
  // Build subject accuracy map
  const subjectAccuracy = useMemo(() => {
    const map = new Map<string, { correct: number; total: number }>();
    data.answers.forEach((a) => {
      const meta = data.metadata.get(a.question_id);
      if (!meta) return;
      const s = map.get(meta.subject) ?? { correct: 0, total: 0 };
      s.total++;
      if (a.is_correct) s.correct++;
      map.set(meta.subject, s);
    });
    return map;
  }, [data]);

  // Weak subjects for slider
  const weakSubjects = useMemo<SubjectSliderState[]>(() => {
    return [...subjectAccuracy.entries()]
      .filter(([, v]) => pct(v.correct, v.total) < 70)
      .sort((a, b) => pct(a[1].correct, a[1].total) - pct(b[1].correct, b[1].total))
      .slice(0, 3)
      .map(([subject, v]) => ({
        subject,
        currentAccuracy: pct(v.correct, v.total),
        sliderValue: pct(v.correct, v.total),
      }));
  }, [subjectAccuracy]);

  const [sliders, setSliders] = useState<SubjectSliderState[]>([]);
  useEffect(() => {
    setSliders(weakSubjects);
  }, [weakSubjects]);

  // Compute simulated scaled score
  const simulatedScore = useMemo(() => {
    if (sliders.length === 0) {
      return Math.round(pct(data.correctAttempts, data.totalAttempts) * 2);
    }
    // baseline from all subjects, then boost weak ones
    let baseTotal = data.totalAttempts;
    let baseCorrect = data.correctAttempts;
    sliders.forEach((sl) => {
      const s = subjectAccuracy.get(sl.subject);
      if (!s) return;
      const boost = sl.sliderValue - sl.currentAccuracy;
      baseCorrect += Math.round(s.total * boost / 100);
    });
    const simPct = baseTotal > 0 ? baseCorrect / baseTotal : 0;
    return Math.min(200, Math.round(simPct * 200));
  }, [sliders, data, subjectAccuracy]);

  const PASSING_SCORE = passingStandard.score;
  const distToPassing = Math.max(0, PASSING_SCORE - simulatedScore);

  // Fatigue chart data: derived from real practice sessions (8+ questions, <20min gaps)
  const fatigue = useMemo(() => computeFatigueData(data.answers), [data.answers]);
  const fatigueData = fatigue.buckets.map((b) => ({ ...b, group: t(b.group) }));

  const trendData = data.recentTrend.map((acc, i) => ({ session: `S${i + 1}`, accuracy: acc }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Section A: Scaled Score Simulator */}
      <div>
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
          <TrendingUp className="h-4 w-4 text-primary" />
          {t('performance.scaledScoreSimulator')}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t('performance.scaledScoreDescription')}
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Sliders */}
          <Card className="hover:shadow-md transition">
            <CardContent className="p-5 space-y-5">
              {sliders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('performance.allSubjectsAtTarget')}</p>
              ) : (
                sliders.map((sl, i) => (
                  <div key={sl.subject}>
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1 mb-2">
                      <span className="text-sm font-semibold text-slate-700 break-words">{sl.subject}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{t('performance.estimatedBoostTo')}</span>
                        <span className="text-sm font-bold text-primary">{sl.sliderValue}%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={sl.sliderValue}
                      onChange={(e) => {
                        const next = [...sliders];
                        next[i] = { ...sl, sliderValue: Number(e.target.value) };
                        setSliders(next);
                      }}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                      <span>{t('performance.currentAccuracy', { pct: sl.currentAccuracy })}</span>
                      <span>100%</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Simulated score panel */}
          <Card className="hover:shadow-md transition border-primary/20 bg-primary/5">
            <CardContent className="p-5 flex flex-col items-center justify-center gap-4">
              <p className="text-sm font-semibold text-primary uppercase tracking-wide">
                {t('performance.simulatedScore')}
              </p>
              <div className="text-6xl font-bold text-primary">{simulatedScore}</div>
              <div className="w-full">
                <Progress value={Math.min(100, (simulatedScore / PASSING_SCORE) * 100)} className="h-3" />
                <p className="text-xs text-center text-muted-foreground mt-2">
                  {distToPassing > 0
                    ? t('performance.distanceToNY', { state: passingStandard.label, score: PASSING_SCORE, diff: distToPassing })
                    : t('performance.nyPassingReached', { state: passingStandard.label })}
                </p>
              </div>
              <ReadinessGauge score={Math.min(100, Math.round((simulatedScore / PASSING_SCORE) * 100))} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Section B: Fatigue Chart */}
      <div>
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
          <Activity className="h-4 w-4 text-primary" />
          {t('performance.fatigueChart')}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t('performance.fatigueChartDescription')}
        </p>
        <Card className="hover:shadow-md transition">
          <CardContent className="p-3 sm:p-5">
            {fatigueData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                {t('performance.fatigueInsufficientData')}
              </p>
            ) : (
              <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={fatigueData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <XAxis dataKey="group" tick={{ fontSize: 12 }} />
                      <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => [`${v ?? ''}%`, '']} />
                      <Legend />
                      <Bar dataKey="focus" name={t('performance.focusLevel')} fill="#22c55e" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="expectedErrors" name={t('performance.expectedErrorRate')} fill="#ef4444" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-800">
                  {fatigueData[3].focus < fatigueData[0].focus - 10
                    ? t('performance.fatigueWarning')
                    : t('performance.fatigueStable')}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {t('performance.fatigueSessionNote', { count: fatigue.sessionCount })}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent trend */}
      {trendData.length > 1 && (
        <Card className="hover:shadow-md transition">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              {t('performance.recentTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-5">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <LineChart data={trendData}>
                  <XAxis dataKey="session" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [`${v ?? ''}%`, t('performance.overallAccuracyLabel')]} />
                  <Line
                    type="monotone"
                    dataKey="accuracy"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    isAnimationActive
                    animationDuration={800}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const VALID_TABS = ['prescription', 'conceptMap', 'errorTrap', 'progress'] as const;
type TabValue = typeof VALID_TABS[number];

export default function PerformancePage() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab') ?? 'prescription';
  const activeTab: TabValue = (VALID_TABS as readonly string[]).includes(rawTab)
    ? (rawTab as TabValue)
    : 'prescription';
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);
  const [examState, setExamState] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Read the user's chosen exam jurisdiction (set on the dashboard) so the
  // scaled-score simulator targets the right passing line instead of NY's.
  useEffect(() => {
    if (!user?.id) return;
    const saved = localStorage.getItem(`passbar_exam_state_${user.id}`);
    if (saved) setExamState(saved);
  }, [user?.id]);

  const passingStandard = useMemo(() => getPassingStandard(examState), [examState]);

  useEffect(() => {
    // auth 尚未解析完成時先不載入（AuthGuard 會處理未登入導向）。
    // 不能用 mounted ref 擋重跑：首次 render 時 user 常是 undefined，
    // 擋掉後續重跑會讓資料永遠載不進來，整頁卡在空數據。
    if (!user?.id) return;

    const load = async () => {
      setLoading(true);

      type PerformanceDataResponse = {
        answers: Array<{
          questionId: string; isCorrect: boolean; answeredAt: string | null; timeSpentSeconds: number | null;
          confidence: string | null; changedAnswer: boolean | null; errorType: string | null;
          selectedChoice: string | null; correctAnswer: string | null;
        }>;
        conceptMastery: Array<{
          subject: string; topic: string; microConcept: string; attempts: number; correct: number;
          status: string; lastAttemptAt: string | null;
        }>;
        metadata: Array<{
          id: string; subject: string; chapterId: string; chapterName: string; topic: string | null;
          microConcept: string | null; trapType: string | null; trapTypeIsNew: boolean | null;
          skillTested: string | null; keywordMeta: KeywordMeta | null; highlightMeta: HighlightMeta | null;
        }>;
      };

      let data: PerformanceDataResponse;
      try {
        data = await api.get<PerformanceDataResponse>('/attempts/dashboard/performance-data');
      } catch (err) {
        console.warn('[PassBar] Failed to load performance data:', err);
        setPageData({
          answers: [], metadata: new Map(), conceptMastery: [],
          totalAttempts: 0, correctAttempts: 0, avgTimeSeconds: 0,
          streakDays: 0, errorTypeBreakdown: {}, recentTrend: [], weakConcepts: [],
        });
        setLoading(false);
        return;
      }

      const answers: AnswerRow[] = data.answers.map((a) => ({
        question_id: a.questionId,
        is_correct: a.isCorrect,
        answered_at: a.answeredAt,
        time_spent_seconds: a.timeSpentSeconds,
        confidence: a.confidence,
        changed_answer: a.changedAnswer,
        error_type: a.errorType,
        selected_choice: a.selectedChoice,
        correct_answer: a.correctAnswer,
      }));
      const conceptMastery: ConceptMasteryRow[] = data.conceptMastery.map((c) => ({
        subject: c.subject,
        topic: c.topic,
        micro_concept: c.microConcept,
        attempts: c.attempts,
        correct: c.correct,
        status: c.status,
        last_attempt_at: c.lastAttemptAt,
      }));

      const metaRows: QuestionMetaRow[] = data.metadata.map((r) => ({
        id: r.id,
        subject: r.subject,
        chapter_id: r.chapterId,
        chapter_name: r.chapterName,
        topic: r.topic,
        micro_concept: r.microConcept,
        trap_type: r.trapType,
        trap_type_is_new: r.trapTypeIsNew,
        skill_tested: r.skillTested,
        keyword_meta: r.keywordMeta,
        highlight_meta: r.highlightMeta,
      }));
      const metadata = new Map(metaRows.map((r) => [r.id, r]));

      const correct = answers.filter((a) => a.is_correct).length;
      const totalSecs = answers.reduce((s, a) => s + (a.time_spent_seconds ?? 0), 0);
      const avgTime = answers.length > 0 ? Math.round(totalSecs / answers.length) : 0;

      const errorTypeBreakdown = computeErrorTypeBreakdown(answers);
      const recentTrend = computeRecentTrend(answers);
      const streakDays = computeStreakDays(answers);

      const conceptMap = new Map<string, { concept: string; subject: string; topic: string; attempts: number; correct: number; totalTime: number }>();
      answers.forEach((a) => {
        const meta = metadata.get(a.question_id);
        if (!meta) return;
        const key = `${meta.subject}::${meta.chapter_name}::${meta.micro_concept ?? meta.chapter_name}`;
        const entry = conceptMap.get(key) ?? { concept: meta.micro_concept ?? meta.chapter_name, subject: meta.subject, topic: meta.chapter_name, attempts: 0, correct: 0, totalTime: 0 };
        entry.attempts++;
        if (a.is_correct) entry.correct++;
        entry.totalTime += a.time_spent_seconds ?? 0;
        conceptMap.set(key, entry);
      });
      type ConceptBucket = { concept: string; subject: string; topic: string; attempts: number; correct: number; totalTime: number };
      const weakConcepts = ([...conceptMap.values()] as ConceptBucket[])
        .filter((c) => c.attempts >= 2 && pct(c.correct, c.attempts) < 65)
        .sort((a, b) => pct(a.correct, a.attempts) - pct(b.correct, b.attempts))
        .slice(0, 10)
        .map((c) => ({ ...c, avgTime: Math.round(c.totalTime / c.attempts) }));

      setPageData({
        answers,
        metadata,
        conceptMastery,
        totalAttempts: answers.length,
        correctAttempts: correct,
        avgTimeSeconds: avgTime,
        streakDays,
        errorTypeBreakdown,
        recentTrend,
        weakConcepts,
      });
      setLoading(false);
    };

    load();
  }, [user?.id]);

  if (loading) return <LoadingSkeleton />;

  if (!pageData || pageData.totalAttempts === 0) {
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
              <p className="mt-2 max-w-xl text-muted-foreground">{t('performance.noAnswersDescription')}</p>
            </div>
            <Button asChild>
              <Link href="/create">{t('performance.startPractice')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overallAccuracy = pct(pageData.correctAttempts, pageData.totalAttempts);
  const accuracyColor = overallAccuracy < 50 ? 'text-red-600' : overallAccuracy >= 70 ? 'text-green-600' : 'text-amber-600';

  const tabDefs: { value: TabValue; label: string; icon: React.ReactNode }[] = [
    { value: 'prescription', label: t('performance.tabs.prescription'), icon: <Sparkles className="h-4 w-4" /> },
    { value: 'conceptMap',   label: t('performance.tabs.conceptMap'),   icon: <MapIcon    className="h-4 w-4" /> },
    { value: 'errorTrap',    label: t('performance.tabs.errorTrap'),    icon: <AlertTriangle className="h-4 w-4" /> },
    { value: 'progress',     label: t('performance.tabs.progress'),     icon: <TrendingUp className="h-4 w-4" /> },
  ];

  return (
    <div
      className={cn(
        'space-y-6 transition-all duration-700 w-full max-w-full overflow-x-hidden',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}
    >
      {/* Page-level Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('performance.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('performance.description')}</p>
        </div>

        {/* Stats summary */}
        <div className="flex shrink-0 rounded-lg border bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-r">
            <p className="text-xs text-muted-foreground">{t('performance.totalAnswered')}</p>
            <p className="text-lg font-bold text-slate-900">{t('performance.questionCount', { count: pageData.totalAttempts })}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground">{t('performance.overallAccuracyLabel')}</p>
            <p className={cn('text-lg font-bold', accuracyColor)}>{overallAccuracy}%</p>
          </div>
        </div>
      </header>

      {/* 4-tab horizontal nav (URL-driven) */}
      <div className="border-b border-slate-200 -mx-4 px-4 sm:mx-0 sm:px-0">
        <nav className="flex gap-1 overflow-x-auto pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] -mb-px">
          {tabDefs.map((tab) => (
            <Link
              key={tab.value}
              href={`/performance?tab=${tab.value}`}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-all duration-150',
                activeTab === tab.value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-slate-800 hover:border-slate-300',
              )}
            >
              {tab.icon}
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'prescription' && <PrescriptionTab data={pageData} t={t} language={language} />}
        {activeTab === 'conceptMap'   && <ConceptMapTab   data={pageData} t={t} />}
        {activeTab === 'errorTrap'    && <ErrorTrapTab    data={pageData} t={t} language={language} />}
        {activeTab === 'progress'     && <ProgressTab     data={pageData} t={t} passingStandard={passingStandard} />}
      </div>
    </div>
  );
}
