"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Check, Loader2, Flag, Bug, Lightbulb, CheckCircle2, Clock, MessageSquare, User, Filter,
} from 'lucide-react';
import { getAdminDb } from '@/lib/admin-client';
import { resolveQuestionReport, type QuestionReport, type ReportCategory } from '@/lib/question-reports';
import { getFeedback, resolveFeedback, type Feedback, type FeedbackCategory } from '@/lib/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Suspense } from 'react';

// ─── Unified feedback item ─────────────────────────────────────────────────────

type UnifiedItem = {
  id: string;
  categories: { labelKey: string; color: string }[];
  message: string | null;
  subject: string | null;
  questionSnippet?: { subject: string; chapter_name: string; question_text: string } | null;
  refInfo?: string | null;
  language?: string | null;
  reporterLabel: string;
  resolved: boolean;
  created_at: string;
  onResolve: () => Promise<boolean>;
};

const QUESTION_CATEGORY_LABEL_KEYS: Record<ReportCategory, string> = {
  wrong_answer:          'admin.catWrongAnswer',
  typo:                  'admin.catTypo',
  unclear:               'admin.catUnclear',
  outdated:              'admin.catOutdated',
  explanation_incorrect: 'admin.catExplanationIncorrect',
  other:                 'admin.catOther',
};

const QUESTION_CATEGORY_COLORS: Record<ReportCategory, string> = {
  wrong_answer:          'bg-red-100 text-red-700 border-red-200',
  typo:                  'bg-orange-100 text-orange-700 border-orange-200',
  unclear:               'bg-amber-100 text-amber-700 border-amber-200',
  outdated:              'bg-blue-100 text-blue-700 border-blue-200',
  explanation_incorrect: 'bg-purple-100 text-purple-700 border-purple-200',
  other:                 'bg-slate-100 text-slate-600 border-slate-200',
};

const FEEDBACK_CATEGORY_LABEL_KEYS: Record<FeedbackCategory, string> = {
  content: 'admin.catContent',
  bug:     'admin.catBug',
  feature: 'admin.catFeature',
  account: 'admin.catAccount',
  other:   'admin.catOther',
};

const FEEDBACK_CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  content: 'bg-orange-100 text-orange-700 border-orange-200',
  bug:     'bg-red-100 text-red-700 border-red-200',
  feature: 'bg-blue-100 text-blue-700 border-blue-200',
  account: 'bg-purple-100 text-purple-700 border-purple-200',
  other:   'bg-slate-100 text-slate-600 border-slate-200',
};

function reporterName(profile: { full_name: string | null; email: string | null } | null | undefined, fallbackEmail?: string | null) {
  return profile?.full_name ?? profile?.email ?? fallbackEmail ?? null;
}

function questionReportToItem(report: QuestionReport, questionsMap: Record<string, { question_text: string; subject: string; chapter_name: string }>): UnifiedItem {
  const categories = report.categories && report.categories.length > 0 ? report.categories : [report.category];
  return {
    id: report.id,
    categories: categories.map((c) => ({ labelKey: QUESTION_CATEGORY_LABEL_KEYS[c], color: QUESTION_CATEGORY_COLORS[c] })),
    message: report.message,
    subject: null,
    questionSnippet: questionsMap[report.question_id] ?? null,
    refInfo: report.question_id,
    language: report.language,
    reporterLabel: reporterName(report.profiles) ?? '',
    resolved: report.resolved,
    created_at: report.created_at,
    onResolve: () => resolveQuestionReport(report.id),
  };
}

function feedbackToItem(feedback: Feedback): UnifiedItem {
  const category = (feedback.category as FeedbackCategory) in FEEDBACK_CATEGORY_LABEL_KEYS
    ? (feedback.category as FeedbackCategory)
    : 'other';
  const refParts = [feedback.ref_subject, feedback.ref_chapter].filter(Boolean);
  return {
    id: feedback.id,
    categories: [{ labelKey: FEEDBACK_CATEGORY_LABEL_KEYS[category], color: FEEDBACK_CATEGORY_COLORS[category] }],
    message: feedback.message,
    subject: feedback.subject,
    questionSnippet: null,
    refInfo: feedback.qid ?? null,
    language: null,
    reporterLabel: reporterName(feedback.profiles, feedback.email) ?? '',
    resolved: feedback.resolved,
    created_at: feedback.created_at,
    onResolve: () => resolveFeedback(feedback.id),
  };
}

// ─── Shared feedback list tab ──────────────────────────────────────────────────

function FeedbackListTab({
  title,
  description,
  load,
}: {
  title: string;
  description: string;
  load: (filterResolved: 'unresolved' | 'resolved' | 'all') => Promise<UnifiedItem[]>;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<UnifiedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [filterResolved, setFilterResolved] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');

  const reload = useCallback(async () => {
    setLoading(true);
    const data = await load(filterResolved);
    setItems(data);
    setLoading(false);
  }, [load, filterResolved]);

  useEffect(() => { reload(); }, [reload]);

  const handleResolve = async (item: UnifiedItem) => {
    setResolving((prev) => ({ ...prev, [item.id]: true }));
    const ok = await item.onResolve();
    if (ok) {
      setItems((prev) => prev.map((i) =>
        i.id === item.id ? { ...i, resolved: true } : i,
      ));
    }
    setResolving((prev) => ({ ...prev, [item.id]: false }));
  };

  function timeAgo(value: string) {
    const diff = Date.now() - new Date(value).getTime();
    if (diff < 3_600_000) return t('admin.timeAgoMin', { n: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return t('admin.timeAgoHour', { n: Math.floor(diff / 3_600_000) });
    return t('admin.timeAgoDay', { n: Math.floor(diff / 86_400_000) });
  }

  const unresolvedCount = items.filter((i) => !i.resolved).length;

  const FILTER_LABELS: Record<'unresolved' | 'all' | 'resolved', string> = {
    unresolved: t('admin.feedbackUnresolved'),
    all:        t('admin.feedbackAll'),
    resolved:   t('admin.feedbackResolved'),
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
        {unresolvedCount > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
            {t('admin.feedbackPendingCount', { count: unresolvedCount })}
          </span>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {(['unresolved', 'all', 'resolved'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setFilterResolved(v)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filterResolved === v
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50',
            )}
          >
            {FILTER_LABELS[v]}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> {t('admin.feedbackLoading')}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-400" />
          <p className="text-sm text-muted-foreground">{t('admin.feedbackEmpty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                'rounded-xl border bg-white p-5 transition-colors',
                item.resolved ? 'border-slate-100 opacity-60' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Category + time */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.categories.map((cat) => (
                      <Badge key={cat.labelKey} className={cn('text-xs border font-medium', cat.color)}>
                        <Flag className="h-3 w-3 mr-1" />
                        {t(cat.labelKey as Parameters<typeof t>[0])}
                      </Badge>
                    ))}
                    {item.language && (
                      <Badge className="text-xs border bg-slate-100 text-slate-600 border-slate-200">
                        {item.language}
                      </Badge>
                    )}
                    {item.resolved && (
                      <Badge className="text-xs border bg-green-100 text-green-700 border-green-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {t('admin.feedbackResolvedBadge')}
                      </Badge>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {timeAgo(item.created_at)}
                    </span>
                  </div>

                  {/* Subject */}
                  {item.subject && (
                    <p className="text-sm font-medium text-slate-800">{item.subject}</p>
                  )}

                  {/* Question snippet */}
                  {item.questionSnippet && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 border border-slate-100">
                      <span className="font-medium text-primary mr-1.5">{item.questionSnippet.subject}</span>
                      <span className="text-slate-400 mr-1.5">·</span>
                      <span className="text-slate-500 mr-2">{item.questionSnippet.chapter_name}</span>
                      <span className="line-clamp-2 text-slate-700 mt-0.5">{item.questionSnippet.question_text}</span>
                    </div>
                  )}

                  {/* Message */}
                  {item.message && (
                    <div className="flex items-start gap-2 text-sm text-slate-700">
                      <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <p className="leading-snug">{item.message}</p>
                    </div>
                  )}

                  {/* Reporter + ref info */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                    <User className="h-3 w-3" />
                    {item.reporterLabel || t('admin.feedbackAnonymous')}
                    {item.refInfo && (
                      <>
                        <span className="text-slate-300 mx-1">·</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {t('admin.feedbackQuestionId', { id: item.refInfo })}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action */}
                {!item.resolved && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-8 text-xs border-green-300 text-green-700 hover:bg-green-50"
                    disabled={resolving[item.id]}
                    onClick={() => handleResolve(item)}
                  >
                    {resolving[item.id]
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <><Check className="h-3 w-3 mr-1" />{t('admin.feedbackMarkResolved')}</>
                    }
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab loaders ────────────────────────────────────────────────────────────────

function useTabLoaders() {
  const db = getAdminDb();

  const loadQuestionFeedback = useCallback(async (filterResolved: 'unresolved' | 'resolved' | 'all') => {
    if (!db) return [];

    let reportsQuery = db
      .from('question_reports')
      .select('*, profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (filterResolved === 'unresolved') reportsQuery = reportsQuery.eq('resolved', false);
    else if (filterResolved === 'resolved') reportsQuery = reportsQuery.eq('resolved', true);

    const [{ data: reportsData }, contentFeedback] = await Promise.all([
      reportsQuery,
      getFeedback({ categories: ['content'], resolved: filterResolved === 'all' ? undefined : filterResolved === 'resolved' }),
    ]);

    const reports = (reportsData ?? []) as QuestionReport[];
    const questionIds = [...new Set(reports.map((r) => r.question_id))];
    let questionsMap: Record<string, { question_text: string; subject: string; chapter_name: string }> = {};

    if (questionIds.length > 0) {
      const { data: qData } = await db
        .from('questions')
        .select('id, question_text, subject, chapter_name')
        .in('id', questionIds);
      for (const q of (qData ?? []) as { id: string; question_text: string; subject: string; chapter_name: string }[]) {
        questionsMap[q.id] = { question_text: q.question_text, subject: q.subject, chapter_name: q.chapter_name };
      }
    }

    const items = [
      ...reports.map((r) => questionReportToItem(r, questionsMap)),
      ...contentFeedback.map(feedbackToItem),
    ];
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return items;
  }, [db]);

  const loadBugFeedback = useCallback(async (filterResolved: 'unresolved' | 'resolved' | 'all') => {
    const data = await getFeedback({ categories: ['bug'], resolved: filterResolved === 'all' ? undefined : filterResolved === 'resolved' });
    return data.map(feedbackToItem);
  }, []);

  const loadSuggestionFeedback = useCallback(async (filterResolved: 'unresolved' | 'resolved' | 'all') => {
    const data = await getFeedback({ categories: ['feature', 'account', 'other'], resolved: filterResolved === 'all' ? undefined : filterResolved === 'resolved' });
    return data.map(feedbackToItem);
  }, []);

  return { loadQuestionFeedback, loadBugFeedback, loadSuggestionFeedback };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function AdminFeedbackContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = (['question', 'bug', 'suggestion'] as const).includes(searchParams.get('tab') as 'question' | 'bug' | 'suggestion')
    ? searchParams.get('tab') as 'question' | 'bug' | 'suggestion'
    : 'question';

  const { loadQuestionFeedback, loadBugFeedback, loadSuggestionFeedback } = useTabLoaders();

  const setTab = (tabKey: string) => {
    router.push(`/admin/questions?tab=${tabKey}`);
  };

  const TABS = [
    { key: 'question', icon: <Flag className="h-3.5 w-3.5" />, label: t('admin.feedbackTabQuestion') },
    { key: 'bug',      icon: <Bug className="h-3.5 w-3.5" />,  label: t('admin.feedbackTabBug') },
    { key: 'suggestion', icon: <Lightbulb className="h-3.5 w-3.5" />, label: t('admin.feedbackTabSuggestion') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-primary">{t('admin.feedbackTitle')}</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === 'question' && (
        <FeedbackListTab
          title={t('admin.feedbackQuestionTitle')}
          description={t('admin.feedbackQuestionDesc')}
          load={loadQuestionFeedback}
        />
      )}
      {tab === 'bug' && (
        <FeedbackListTab
          title={t('admin.feedbackBugTitle')}
          description={t('admin.feedbackBugDesc')}
          load={loadBugFeedback}
        />
      )}
      {tab === 'suggestion' && (
        <FeedbackListTab
          title={t('admin.feedbackSuggestionTitle')}
          description={t('admin.feedbackSuggestionDesc')}
          load={loadSuggestionFeedback}
        />
      )}
    </div>
  );
}

export default function AdminQuestionsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <AdminFeedbackContent />
    </Suspense>
  );
}
