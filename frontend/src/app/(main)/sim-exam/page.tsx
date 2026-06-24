"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getSubjects, getAllQuestionIdsByChapter } from '@/lib/question-bank';
import { emptyQuestionStatusCounts, getAllUserProgress, getQuestionStatusCounts, QuestionStatusCounts } from '@/lib/question-progress';
import { createPracticeSessionRecord } from '@/lib/practice-sessions';
import { Subject, TestSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { GraduationCap, FileText, Clock, BookOpen, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { selectSimExamQuestions } from '@/lib/sim-exam-sampling.mjs';

export default function SimExamPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [statusCounts, setStatusCounts] = useState<QuestionStatusCounts>(emptyQuestionStatusCounts);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    getSubjects().then(setSubjects);
  }, []);

  const totalQuestionCount = useMemo(() => (
    subjects.reduce((sum, s) => sum + s.count, 0)
  ), [subjects]);

  useEffect(() => {
    if (!user?.id || totalQuestionCount === 0) {
      setStatusCounts({ ...emptyQuestionStatusCounts, Unused: totalQuestionCount });
      return;
    }
    getQuestionStatusCounts(user.id, totalQuestionCount).then(setStatusCounts);
  }, [user?.id, totalQuestionCount]);

  const practicedCount = statusCounts.Correct + statusCounts.Incorrect;
  const unpracticedCount = Math.max(totalQuestionCount - practicedCount, 0);

  const handleStart = async () => {
    setIsStarting(true);
    const SIM_EXAM_COUNT = 100;
    const SIM_EXAM_SECONDS = 3 * 60 * 60;

    const allChapterIds = subjects.flatMap(s => s.chapters.map(c => c.id));
    const chapterToSubject = new Map<string, string>();
    for (const s of subjects) {
      for (const c of s.chapters) chapterToSubject.set(c.id, s.name);
    }

    // Lightweight id-only fetch (no question content) for sampling.
    const idsByChapter = await getAllQuestionIdsByChapter();
    const bySubject = new Map<string, string[]>();
    for (const chapterId of allChapterIds) {
      const subjectName = chapterToSubject.get(chapterId);
      if (!subjectName) continue;
      const ids = idsByChapter[chapterId] ?? [];
      if (!bySubject.has(subjectName)) bySubject.set(subjectName, []);
      bySubject.get(subjectName)!.push(...ids);
    }

    const shuffledAll = selectSimExamQuestions(bySubject, SIM_EXAM_COUNT);
    const selectedIds = shuffledAll.map(q => q.id);

    if (selectedIds.length === 0) {
      setIsStarting(false);
      alert(t('simExam.noQuestionsAlert'));
      return;
    }

    const subjectNames = Array.from(new Set(shuffledAll.map(q => q.subject)));
    const chapterIds = allChapterIds;

    const dbSessionId = user?.id
      ? await createPracticeSessionRecord({
        userId: user.id,
        mode: 'SimExam',
        subjectNames,
        chapterIds,
        questionIds: selectedIds,
      })
      : null;

    const newSession: TestSession = {
      id: dbSessionId ?? crypto.randomUUID(),
      createdAt: Date.now(),
      mode: 'SimExam',
      subjects: subjectNames,
      chapters: chapterIds,
      questionCount: selectedIds.length,
      questionIds: selectedIds,
      userAnswers: {},
      status: 'In-Progress',
      timeSpent: 0,
      timeLimitSeconds: SIM_EXAM_SECONDS,
    };

    const sessions = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
    sessions.push(newSession);
    localStorage.setItem('passbar_sessions', JSON.stringify(sessions));

    setIsStarting(false);
    router.push(`/test?id=${encodeURIComponent(newSession.id)}`);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('simExam.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('simExam.description')}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary self-start sm:self-auto">
          <GraduationCap className="h-4 w-4" />
          {t('simExam.badge')}
        </span>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('simExam.totalQuestions')}</div>
          <div className="mt-1.5 text-3xl font-bold text-slate-800">{totalQuestionCount.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('simExam.practicedQuestions')}</div>
          <div className="mt-1.5 text-3xl font-bold text-primary">{practicedCount.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('simExam.unpracticedQuestions')}</div>
          <div className="mt-1.5 text-3xl font-bold text-slate-800">{unpracticedCount.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main CTA card */}
        <Card className="xl:col-span-2 hover:shadow-md transition-shadow border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <GraduationCap className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-base font-semibold">{t('simExam.title')}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{t('simExam.badge')}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { icon: FileText, label: t('simExam.featureQuestions'), desc: t('simExam.featureQuestionsDesc') },
                { icon: Clock,    label: t('simExam.featureTime'),      desc: t('simExam.featureTimeDesc') },
                { icon: BookOpen, label: t('simExam.featureSubjects'),  desc: t('simExam.featureSubjectsDesc') },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex flex-col gap-1.5 rounded-lg border border-primary/15 bg-white px-4 py-3">
                  <div className="flex items-center gap-2 text-primary">
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-semibold">{label}</span>
                  </div>
                  <p className="text-xs text-slate-500">{desc}</p>
                </div>
              ))}
            </div>

            <Button
              onClick={handleStart}
              disabled={isStarting || subjects.length === 0}
              className={cn(
                "group h-12 w-full sm:w-auto min-w-[200px] rounded-xl bg-primary px-8 text-base font-bold text-primary-foreground shadow-md",
                "hover:bg-primary/95 active:scale-[0.98] transition-all duration-200 disabled:opacity-40",
                "flex items-center justify-center gap-2"
              )}
            >
              {isStarting
                ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />{t('simExam.starting')}</>
                : <>{t('simExam.start')}<ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></>
              }
            </Button>
          </CardContent>
        </Card>

        {/* How it works */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <p className="text-base font-semibold">{t('simExam.howItWorksTitle')}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { title: t('simExam.step1Title'), desc: t('simExam.step1Desc') },
              { title: t('simExam.step2Title'), desc: t('simExam.step2Desc') },
              { title: t('simExam.step3Title'), desc: t('simExam.step3Desc') },
            ].map(({ title, desc }, idx) => (
              <div key={idx} className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                  <span className="text-xs font-bold text-primary">{idx + 1}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}

            <div className="mt-2 flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <p className="text-xs text-green-700">
                {t('simExam.featureSubjectsDesc')}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
