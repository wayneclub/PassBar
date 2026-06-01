"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { requestPerformanceDiagnosis } from '@/lib/gemini-feedback';
import {
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
  ChevronDown,
  ChevronRight,
  Clock3,
  Flame,
  Lightbulb,
  Loader2,
  Map as MapIcon,
  Sparkles,
  Target,
  TrendingUp,
  Wrench,
  Zap,
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
};

type QuestionMetaRow = {
  id: string;
  subject: string;
  chapter_id: string;
  topic: string;
  micro_concept: string | null;
  trap_type: string | null;
  skill_tested: string | null;
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
  // group by day, last 10 days with activity
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
  const circumference = Math.PI * radius; // half circle
  const offset = circumference * (1 - clamped / 100);
  const color = clamped >= 75 ? '#22c55e' : clamped >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="80" viewBox="0 0 140 80">
        {/* track */}
        <path
          d="M 14 70 A 56 56 0 0 1 126 70"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* fill */}
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
      // strip potential markdown fences
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned) as DiagnosisResult;
      setDiagnosis(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generating diagnosis');
    } finally {
      setLoading(false);
    }
  }, [data, language]);

  const readiness = diagnosis?.readinessScore ?? Math.round(pct(data.correctAttempts, data.totalAttempts) * 0.85);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header + CTA */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('performance.aiDiagnosis')}
          </h2>
          {data.totalAttempts < 5 && (
            <p className="text-sm text-muted-foreground mt-1">
              {t('performance.sampleTooSmall', { count: data.totalAttempts })}
            </p>
          )}
        </div>
        <Button
          onClick={generateDiagnosis}
          disabled={loading || data.totalAttempts === 0}
          className="gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('performance.diagnosisLoading')}
            </>
          ) : (
            <>
              <Brain className="h-4 w-4" />
              {t('performance.generateDiagnosis')}
            </>
          )}
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {data.totalAttempts === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Activity className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">{t('performance.noDataYet')}</p>
            <Button asChild size="sm">
              <Link href="/create">{t('performance.startPractice')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {diagnosis && (
        <div className="space-y-4">
          {/* Diagnosis text */}
          <Card className="border-primary/20 bg-primary/5 hover:shadow-md transition">
            <CardContent className="p-5">
              <p className="text-slate-700 leading-relaxed">{diagnosis.diagnosis}</p>
              {diagnosis.encouragement && (
                <p className="mt-3 text-primary font-medium flex items-center gap-2">
                  <Flame className="h-4 w-4" />
                  {diagnosis.encouragement}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Top priorities */}
            <Card className="hover:shadow-md transition">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-red-500" />
                  {t('performance.topPriorities')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {diagnosis.topPriorities.map((priority, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="flex-none mt-0.5 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">{priority.concept}</div>
                      <div className="text-xs text-muted-foreground">{priority.subject}</div>
                      <div className="text-xs text-slate-600 mt-1">{priority.reason}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      ~{priority.suggestedMinutes}min
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Study plan */}
            <Card className="hover:shadow-md transition">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  {t('performance.studyPlan')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {diagnosis.studyPlan.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="flex-none mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {step.step}
                    </span>
                    <div className="flex-1">
                      <span className="text-sm text-slate-700">{step.action}</span>
                      <span className="ml-2 text-xs text-muted-foreground">({step.duration})</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Readiness gauge */}
      <Card className="hover:shadow-md transition">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            {t('performance.readinessScore')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-6">
          <ReadinessGauge score={readiness} />
          <Button asChild size="lg" className="gap-2 w-full max-w-xs">
            <Link href="/create">
              <Zap className="h-4 w-4" />
              {t('performance.startSmartTraining')}
            </Link>
          </Button>
        </CardContent>
      </Card>
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

const statusConfig: Record<string, { label: string; colorClass: string; badgeClass: string }> = {
  mastered: { label: 'mastered', colorClass: 'text-green-700', badgeClass: 'bg-green-100 text-green-700' },
  stabilizing: { label: 'stabilizing', colorClass: 'text-blue-700', badgeClass: 'bg-blue-100 text-blue-700' },
  repairing: { label: 'repairing', colorClass: 'text-orange-700', badgeClass: 'bg-orange-100 text-orange-700' },
  struggling: { label: 'struggling', colorClass: 'text-red-700', badgeClass: 'bg-red-100 text-red-700' },
  'under-sampled': { label: 'underSampled', colorClass: 'text-slate-500', badgeClass: 'bg-slate-100 text-slate-600' },
  decaying: { label: 'decaying', colorClass: 'text-yellow-700', badgeClass: 'bg-yellow-100 text-yellow-700' },
};

function ConceptMapTab({
  data,
  t,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Build concept entries from mastery table or fallback to computed
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
    // fallback: compute from answers + metadata
    const map = new Map<string, ConceptEntry>();
    data.answers.forEach((a) => {
      const meta = data.metadata.get(a.question_id);
      if (!meta) return;
      const key = `${meta.subject}::${meta.topic}::${meta.micro_concept ?? meta.topic}`;
      const entry = map.get(key) ?? {
        concept: meta.micro_concept ?? meta.topic,
        subject: meta.subject,
        topic: meta.topic,
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

  const bySubject = useMemo(() => {
    const m = new Map<string, Map<string, ConceptEntry[]>>();
    conceptEntries.forEach((e) => {
      const topics = m.get(e.subject) ?? new Map<string, ConceptEntry[]>();
      const list = topics.get(e.topic) ?? [];
      list.push(e);
      topics.set(e.topic, list);
      m.set(e.subject, topics);
    });
    return m;
  }, [conceptEntries]);

  const subjectEntries = [...bySubject.entries()] as [string, Map<string, ConceptEntry[]>][];

  if (conceptEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <MapIcon className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t('performance.noDataYet')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in fade-in duration-500">
      <h2 className="text-lg font-bold text-slate-800">{t('performance.conceptMastery')}</h2>
      {subjectEntries.map(([subject, topics]) => {
        const isOpen = expanded.has(subject);
        const topicEntries = [...topics.entries()] as [string, ConceptEntry[]][];
        return (
          <Card key={subject} className="overflow-hidden hover:shadow-md transition">
            <button
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition"
              onClick={() => {
                const next = new Set(expanded);
                isOpen ? next.delete(subject) : next.add(subject);
                setExpanded(next);
              }}
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <span className="font-semibold text-slate-800">{subject}</span>
                <Badge variant="outline" className="text-xs">{[...topics.values()].flat().length} concepts</Badge>
              </div>
            </button>
            {isOpen && (
              <div className="border-t">
                {topicEntries.map(([topic, concepts]) => (
                  <div key={topic} className="p-4 border-b last:border-0">
                    <div className="text-sm font-medium text-slate-600 mb-3">{topic}</div>
                    <div className="space-y-2">
                      {concepts.map((c: ConceptEntry, i: number) => {
                        const accuracy = pct(c.correct, c.attempts);
                        const cfg = statusConfig[c.status] ?? statusConfig['under-sampled'];
                        return (
                          <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-800 truncate">{c.concept}</div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                <span>{t('performance.accuracy', { pct: accuracy })}</span>
                                <span>{c.attempts} attempts</span>
                                {c.avgTime > 0 && <span>{t('performance.avgTimeLabel', { sec: Math.round(c.avgTime) })}</span>}
                              </div>
                            </div>
                            <Badge className={cn('shrink-0 text-xs', cfg.badgeClass)}>
                              {t(`performance.${cfg.label}` as Parameters<typeof t>[0])}
                            </Badge>
                            <Button asChild size="sm" variant="outline" className="shrink-0 h-7 text-xs gap-1">
                              <Link href="/create">
                                <Wrench className="h-3 w-3" />
                                {t('performance.repairAction')}
                              </Link>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Tab 3: Error Pattern ────────────────────────────────────────────────────

const ERROR_COLORS: Record<string, string> = {
  'Issue Spotting Error': '#ef4444',
  'Rule Recall Error': '#f97316',
  'Rule Application Error': '#f59e0b',
  'Exception Missed': '#eab308',
  'Fact Trigger Missed': '#84cc16',
  'Similar Concept Confusion': '#06b6d4',
  'Distractor Trap': '#8b5cf6',
  'Time Pressure Guess': '#ec4899',
  'Changed Correct to Wrong': '#64748b',
  Unknown: '#cbd5e1',
};

function ErrorPatternTab({
  data,
  t,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const errorEntries = useMemo(() => {
    return Object.entries(data.errorTypeBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        color: ERROR_COLORS[type] ?? '#94a3b8',
      }));
  }, [data.errorTypeBreakdown]);

  const totalErrors = errorEntries.reduce((s, e) => s + e.count, 0);
  const pieData = errorEntries.map((e) => ({ name: e.type, value: e.count, color: e.color }));

  if (totalErrors === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <CheckCircle2 className="h-10 w-10 text-green-400" />
        <p className="text-muted-foreground">{t('performance.noDataYet')}</p>
      </div>
    );
  }

  const topError = errorEntries[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h2 className="text-lg font-bold text-slate-800">{t('performance.errorTypes')}</h2>
      <div className="grid gap-6 md:grid-cols-2">
        {/* Donut chart */}
        <Card className="hover:shadow-md transition">
          <CardContent className="pt-6">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    isAnimationActive
                    animationDuration={800}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val) => [`${val} (${Math.round(Number(val) / totalErrors * 100)}%)`, '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Ranked list */}
        <Card className="hover:shadow-md transition">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('performance.errorTypes')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {errorEntries.map((entry, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 truncate">{entry.type}</span>
                  <span className="text-muted-foreground ml-2 shrink-0">{entry.count} ({Math.round(entry.count / totalErrors * 100)}%)</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${(entry.count / totalErrors) * 100}%`, backgroundColor: entry.color }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Insight text */}
      {topError && (
        <Card className="border-amber-200 bg-amber-50 hover:shadow-md transition">
          <CardContent className="p-4 flex items-start gap-3">
            <Lightbulb className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-900">
              Your most common error pattern is <strong>{topError.type}</strong> ({Math.round(topError.count / totalErrors * 100)}% of errors).
              Focus on this type during your next review session.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 4: Trap Intelligence ─────────────────────────────────────────────────

function TrapIntelTab({
  data,
  t,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
}) {
  type TrapEntry = { trap: string; count: number; examples: string[] };
  type ConfusionPair = { pair: string; count: number };

  const trapEntries = useMemo<TrapEntry[]>(() => {
    const trapMap = new Map<string, { count: number; examples: string[] }>();
    data.answers.forEach((a) => {
      if (!a.is_correct) {
        const meta = data.metadata.get(a.question_id);
        const trap = meta?.trap_type;
        if (trap) {
          const entry = trapMap.get(trap) ?? { count: 0, examples: [] };
          entry.count++;
          if (entry.examples.length < 2 && meta?.topic) entry.examples.push(meta.topic);
          trapMap.set(trap, entry);
        }
      }
    });
    return ([...trapMap.entries()] as [string, { count: number; examples: string[] }][])
      .sort((a, b) => b[1].count - a[1].count)
      .map(([trap, info]) => ({ trap, ...info }));
  }, [data]);

  // Confusion pairs: concepts where user keeps getting wrong after being right
  const confusionPairs = useMemo<ConfusionPair[]>(() => {
    const pairMap = new Map<string, { count: number }>();
    data.answers.forEach((a) => {
      if (!a.is_correct) {
        const meta = data.metadata.get(a.question_id);
        if (meta?.micro_concept && meta?.topic) {
          const key = `${meta.topic} ↔ ${meta.micro_concept}`;
          const p = pairMap.get(key) ?? { count: 0 };
          p.count++;
          pairMap.set(key, p);
        }
      }
    });
    return ([...pairMap.entries()] as [string, { count: number }][])
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([pair, info]) => ({ pair, ...info }));
  }, [data]);

  if (trapEntries.length === 0 && confusionPairs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 animate-in fade-in duration-500">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t('performance.noDataYet')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h2 className="text-lg font-bold text-slate-800">{t('performance.trapAnalysis')}</h2>

      {trapEntries.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {trapEntries.map((entry, i) => (
            <Card key={i} className="hover:shadow-md transition hover:-translate-y-0.5">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <span className="font-semibold text-slate-800">{entry.trap}</span>
                  </div>
                  <Badge className="bg-red-100 text-red-700 hover:bg-red-100 shrink-0">
                    {entry.count}×
                  </Badge>
                </div>
                {entry.examples.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {entry.examples.map((ex, j) => (
                      <div key={j} className="text-xs text-muted-foreground flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" />
                        {ex}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {confusionPairs.length > 0 && (
        <Card className="hover:shadow-md transition">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              Most Confused Concept Pairs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {confusionPairs.map((cp, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded bg-slate-50">
                <span className="text-sm text-slate-700">{cp.pair}</span>
                <Badge variant="outline">{cp.count}×</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 5: Progress ──────────────────────────────────────────────────────────

function ProgressTab({
  data,
  t,
}: {
  data: PageData;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const trendData = data.recentTrend.map((acc, i) => ({ session: `S${i + 1}`, accuracy: acc }));
  const readiness = Math.round(pct(data.correctAttempts, data.totalAttempts) * 0.85);
  const masteredCount = data.conceptMastery.filter((c) => c.status === 'mastered').length;
  const repairRate = data.conceptMastery.length > 0
    ? Math.round((masteredCount / data.conceptMastery.length) * 100)
    : 0;
  const totalMinutes = Math.round((data.answers.reduce((s, a) => s + (a.time_spent_seconds ?? 0), 0)) / 60);

  const statCards = [
    { icon: <Flame className="h-7 w-7 text-orange-500" />, label: 'Study Streak', value: `${data.streakDays}d` },
    { icon: <CheckCircle2 className="h-7 w-7 text-green-600" />, label: t('performance.correctTotal'), value: `${data.correctAttempts}/${data.totalAttempts}` },
    { icon: <Clock3 className="h-7 w-7 text-blue-500" />, label: 'Time Invested', value: `${totalMinutes}m` },
    { icon: <Target className="h-7 w-7 text-primary" />, label: t('performance.overallAccuracy'), value: `${pct(data.correctAttempts, data.totalAttempts)}%` },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {statCards.map((card, i) => (
          <Card key={i} className="hover:shadow-md transition hover:-translate-y-0.5">
            <CardContent className="flex items-center gap-3 p-5">
              {card.icon}
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend chart */}
      {trendData.length > 1 && (
        <Card className="hover:shadow-md transition">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              {t('performance.recentTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <XAxis dataKey="session" />
                  <YAxis domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v) => [`${v}%`, 'Accuracy']} />
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

      {/* Concept repair rate */}
      {data.conceptMastery.length > 0 && (
        <Card className="hover:shadow-md transition">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Concept Mastery Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Mastered concepts</span>
                <span className="font-semibold">{masteredCount} / {data.conceptMastery.length} ({repairRate}%)</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-1000"
                  style={{ width: `${repairRate}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Readiness */}
      <Card className="hover:shadow-md transition">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            {t('performance.readinessScore')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          <ReadinessGauge score={readiness} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const load = async () => {
      if (!supabase || !user?.id) {
        setPageData({
          answers: [], metadata: new Map(), conceptMastery: [],
          totalAttempts: 0, correctAttempts: 0, avgTimeSeconds: 0,
          streakDays: 0, errorTypeBreakdown: {}, recentTrend: [], weakConcepts: [],
        });
        setLoading(false);
        return;
      }

      setLoading(true);

      const [answersResult, masteryResult] = await Promise.all([
        supabase
          .from('practice_answers')
          .select('question_id, is_correct, answered_at, time_spent_seconds, confidence, changed_answer, error_type')
          .eq('user_id', user.id)
          .order('answered_at', { ascending: true })
          .limit(5000),
        supabase
          .from('user_concept_mastery')
          .select('*')
          .eq('user_id', user.id),
      ]);

      const answers = (answersResult.data ?? []) as AnswerRow[];
      const conceptMastery = (masteryResult.data ?? []) as ConceptMasteryRow[];

      // Load question metadata
      const questionIds = [...new Set(answers.map((a) => a.question_id))];
      const metaRows: QuestionMetaRow[] = [];
      for (const ids of chunk(questionIds, 400)) {
        const { data: rows } = await supabase
          .from('questions')
          .select('id, subject, chapter_id, topic, micro_concept, trap_type, skill_tested')
          .in('id', ids);
        if (rows) metaRows.push(...(rows as QuestionMetaRow[]));
      }
      const metadata = new Map(metaRows.map((r) => [r.id, r]));

      // Compute stats
      const correct = answers.filter((a) => a.is_correct).length;
      const totalSecs = answers.reduce((s, a) => s + (a.time_spent_seconds ?? 0), 0);
      const avgTime = answers.length > 0 ? Math.round(totalSecs / answers.length) : 0;

      const errorTypeBreakdown = computeErrorTypeBreakdown(answers);
      const recentTrend = computeRecentTrend(answers);
      const streakDays = computeStreakDays(answers);

      // Weak concepts
      const conceptMap = new Map<string, { concept: string; subject: string; topic: string; attempts: number; correct: number; totalTime: number }>();
      answers.forEach((a) => {
        const meta = metadata.get(a.question_id);
        if (!meta) return;
        const key = `${meta.subject}::${meta.topic}::${meta.micro_concept ?? meta.topic}`;
        const entry = conceptMap.get(key) ?? { concept: meta.micro_concept ?? meta.topic, subject: meta.subject, topic: meta.topic, attempts: 0, correct: 0, totalTime: 0 };
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

  const tabItems = [
    { value: 'prescription', label: t('performance.tabs.prescription'), icon: <Sparkles className="h-4 w-4" /> },
    { value: 'conceptMap', label: t('performance.tabs.conceptMap'), icon: <MapIcon className="h-4 w-4" /> },
    { value: 'errorPattern', label: t('performance.tabs.errorPattern'), icon: <AlertTriangle className="h-4 w-4" /> },
    { value: 'trapIntel', label: t('performance.tabs.trapIntel'), icon: <Lightbulb className="h-4 w-4" /> },
    { value: 'progress', label: t('performance.tabs.progress'), icon: <TrendingUp className="h-4 w-4" /> },
  ];

  return (
    <div
      className={cn(
        'space-y-6 transition-all duration-700',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}
    >
      <header>
        <h1 className="text-4xl font-bold text-primary">{t('performance.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('performance.description')}</p>
      </header>

      <Tabs defaultValue="prescription">
        <TabsList className="flex flex-wrap h-auto gap-1 mb-2">
          {tabItems.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-1.5">
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="prescription">
          <PrescriptionTab data={pageData} t={t} language={language} />
        </TabsContent>

        <TabsContent value="conceptMap">
          <ConceptMapTab data={pageData} t={t} />
        </TabsContent>

        <TabsContent value="errorPattern">
          <ErrorPatternTab data={pageData} t={t} />
        </TabsContent>

        <TabsContent value="trapIntel">
          <TrapIntelTab data={pageData} t={t} />
        </TabsContent>

        <TabsContent value="progress">
          <ProgressTab data={pageData} t={t} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
