"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Calendar,
  Clock,
  CheckCircle2,
  ArrowRight,
  Search,
  Filter,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getQuestionsByIds } from '@/lib/question-bank';
import { supabase } from '@/lib/supabase';
import type { Question } from '@/lib/types';

type PracticeSessionRow = {
  id: string;
  mode: string | null;
  status: string | null;
  subject_ids: string[] | null;
  chapter_ids: string[] | null;
  question_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  total_time_seconds: number | null;
  raw: {
    subjects?: string[];
    chapters?: string[];
    questionIds?: string[];
    userAnswers?: Record<string, string>;
    createdAt?: number;
  } | null;
};

type PracticeAnswerRow = {
  session_id: string;
  question_id: string;
  selected_choice: string | null;
  is_correct: boolean | null;
};

type ReviewSession = {
  id: string;
  mode: string;
  subjectLabel: string;
  searchableText: string;
  createdAt: Date;
  durationSeconds: number;
  correct: number;
  total: number;
  percent: number;
};

function formatDuration(seconds: number) {
  if (!seconds || seconds < 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function getSessionDuration(session: PracticeSessionRow) {
  if (session.total_time_seconds && session.total_time_seconds > 0) return session.total_time_seconds;
  if (!session.started_at || !session.completed_at) return 0;
  return Math.max(0, Math.round((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000));
}

function getAnswerChoiceKey(question: Question, answer: string) {
  const candidates = [question.options, question.bilingualOptions ?? []];
  for (const options of candidates) {
    const index = options.findIndex((option) => option === answer);
    if (index !== -1) return String.fromCharCode(65 + index);
  }
  return answer.match(/^\s*([A-D])\./i)?.[1]?.toUpperCase() ?? null;
}

export default function ReviewHistoryPage() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user?.id || !supabase) {
        setSessions([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const { data: sessionRows, error: sessionError } = await supabase
        .from('practice_sessions')
        .select('id, mode, status, subject_ids, chapter_ids, question_count, started_at, completed_at, total_time_seconds, raw')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false });

      if (sessionError) {
        console.warn('Unable to load practice history:', sessionError.message);
        setSessions([]);
        setIsLoading(false);
        return;
      }

      const rows = (sessionRows ?? []) as PracticeSessionRow[];
      const ids = rows.map((row) => row.id);
      const answerRows = ids.length > 0
        ? await supabase
          .from('practice_answers')
          .select('session_id, question_id, selected_choice, is_correct')
          .in('session_id', ids)
        : { data: [] as PracticeAnswerRow[], error: null };

      if (answerRows.error) {
        console.warn('Unable to load practice answers:', answerRows.error.message);
      }

      const answersBySession = new Map<string, PracticeAnswerRow[]>();
      ((answerRows.data ?? []) as PracticeAnswerRow[]).forEach((answer) => {
        const answers = answersBySession.get(answer.session_id) ?? [];
        answers.push(answer);
        answersBySession.set(answer.session_id, answers);
      });

      const rawAnswerQuestionIds = Array.from(new Set(rows.flatMap((row) => Object.keys(row.raw?.userAnswers ?? {}))));
      const rawQuestionRows = rawAnswerQuestionIds.length > 0 ? await getQuestionsByIds(rawAnswerQuestionIds) : [];
      const rawQuestionById = new Map(rawQuestionRows.map((question) => [question.id, question]));

      const nextSessions = rows.map((row) => {
        const answers = answersBySession.get(row.id) ?? [];
        const rawAnswers = row.raw?.userAnswers ?? {};
        const rawAnswerEntries = Object.entries(rawAnswers);
        const total = answers.length > 0 ? answers.length : rawAnswerEntries.length;
        const correct = answers.length > 0
          ? answers.filter((answer) => answer.is_correct).length
          : rawAnswerEntries.filter(([questionId, answer]) => {
            const question = rawQuestionById.get(questionId);
            const selectedChoice = question ? getAnswerChoiceKey(question, answer) : null;
            const correctChoice = (question?.apiAnswerKey ?? question?.correctAnswerLetter)?.toUpperCase() ?? null;
            return Boolean(selectedChoice && correctChoice && selectedChoice === correctChoice);
          }).length;
        const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
        const subjects = row.raw?.subjects?.length ? row.raw.subjects : row.subject_ids ?? [];
        const chapters = row.raw?.chapters?.length ? row.raw.chapters : row.chapter_ids ?? [];
        const createdAt = row.raw?.createdAt ? new Date(row.raw.createdAt) : new Date(row.started_at ?? Date.now());

        return {
          id: row.id,
          mode: row.mode ?? 'Tutor',
          subjectLabel: subjects.length > 0 ? subjects.join(', ') : t('review.mixedSubjects'),
          searchableText: [...subjects, ...chapters, row.status ?? ''].join(' ').toLowerCase(),
          createdAt,
          durationSeconds: getSessionDuration(row),
          correct,
          total,
          percent,
        };
      }).filter((session) => session.total > 0);

      setSessions(nextSessions);
      setIsLoading(false);
    };

    loadHistory();
  }, [t, user?.id]);

  const filteredSessions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sessions;
    return sessions.filter((session) => session.searchableText.includes(term) || session.subjectLabel.toLowerCase().includes(term));
  }, [search, sessions]);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }), [language]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('review.title')}</h1>
          <p className="text-lg text-muted-foreground mt-1">{t('review.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-12 pl-10 w-72 text-base"
              placeholder={t('review.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" className="h-12 w-12">
            <Filter className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card className="p-12 text-center bg-white/50">
          <p className="text-muted-foreground">{t('review.loading')}</p>
        </Card>
      ) : filteredSessions.length === 0 ? (
        <Card className="p-12 text-center bg-white/50 border-dashed">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-muted rounded-full">
              <Calendar className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-xl font-bold">{t('review.noSessions')}</h3>
              <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
                {t('review.noSessionsDescription')}
              </p>
            </div>
            <Button asChild className="mt-2">
              <Link href="/create">{t('review.createFirstTest')}</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredSessions.map((session) => (
            <Card key={session.id} className="overflow-hidden hover:shadow-md transition-shadow group border-l-4 border-l-primary">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row items-center">
                  <div className="p-6 md:w-48 border-b md:border-b-0 md:border-r flex flex-col items-center justify-center bg-primary/5">
                    <div className="text-3xl font-black text-primary">{session.percent}%</div>
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-1">{t('review.accuracy')}</div>
                  </div>

                  <div className="p-6 flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-secondary text-secondary font-bold text-xs">
                          {session.mode}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {dateFormatter.format(session.createdAt)}
                        </span>
                      </div>
                      <h3 className="font-bold text-xl truncate">
                        {session.subjectLabel}
                      </h3>
                    </div>

                    <div className="flex items-center gap-8">
                      <div className="flex flex-col">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Clock className="w-4 h-4" /> {t('review.duration')}
                        </span>
                        <span className="text-lg font-semibold">{formatDuration(session.durationSeconds)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4 text-green-500" /> {t('review.correct')}
                        </span>
                        <span className="text-lg font-semibold">{session.correct} / {session.total}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end">
                      <Button variant="ghost" className="group-hover:text-primary gap-2 text-base" asChild>
                        <Link href={`/test?id=${encodeURIComponent(session.id)}&review=1`}>
                          {t('review.reviewQuestions')}
                          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
