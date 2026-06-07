"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getMbeChineseLabel } from '@/lib/mbe-labels';
import { getAllQuestionIdsByChapter, getQuestionsByChapterIds, getSubjects } from '@/lib/question-bank';
import { Subject, TestSession } from '@/lib/types';
import { getBrowseProgressByUser, BrowseProgressRow } from '@/lib/topic-study-progress';
import { getBrowseMarkedChapterIds, getBrowseChapterStateCounts } from '@/lib/topic-study-question-states';
import { saveTestQuestionSnapshot } from '@/lib/offline-cache';
import { BookOpen, ListOrdered, Shuffle, ArrowRight, Footprints, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { PillToggle, SettingCard } from '@/components/SettingCard';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function BrowsePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, language } = useI18n();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [questionOrder, setQuestionOrder] = useState<'sequential' | 'random'>('sequential');
  const [learnFilter, setLearnFilter] = useState<'all' | 'learned' | 'unlearned' | 'marked'>('all');
  const [markedChapterIds, setMarkedChapterIds] = useState<Set<string>>(new Set());
  const [learnedQuestionCount, setLearnedQuestionCount] = useState(0);
  const [markedQuestionCount, setMarkedQuestionCount] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [allChapterQIds, setAllChapterQIds] = useState<Record<string, string[]>>({});
  const [browseProgress, setBrowseProgress] = useState<BrowseProgressRow[]>([]);

  useEffect(() => {
    getSubjects().then(setSubjects);
    getAllQuestionIdsByChapter().then(setAllChapterQIds);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    getBrowseProgressByUser(user.id).then(setBrowseProgress);
    // Load browse-mode marks (independent from test-mode marks)
    if (Object.keys(allChapterQIds).length > 0) {
      getBrowseMarkedChapterIds(user.id, allChapterQIds).then(setMarkedChapterIds);
    }
    getBrowseChapterStateCounts(user.id).then((counts) => {
      let learned = 0;
      let marked = 0;
      counts.forEach((v) => { learned += v.learnedCount; marked += v.markedCount; });
      setLearnedQuestionCount(learned);
      setMarkedQuestionCount(marked);
    });
  }, [user?.id, allChapterQIds]);

  const progressByChapter = useMemo(() => {
    const map = new Map<string, BrowseProgressRow>();
    browseProgress.forEach((p) => map.set(p.chapter_id, p));
    return map;
  }, [browseProgress]);

  // Filter chapters by learned / marked status
  const filteredSubjects = useMemo(() => {
    if (learnFilter === 'all') return subjects;
    return subjects.map((subject) => ({
      ...subject,
      chapters: subject.chapters.filter((ch) => {
        if (learnFilter === 'learned') return progressByChapter.has(ch.id);
        if (learnFilter === 'unlearned') return !progressByChapter.has(ch.id);
        if (learnFilter === 'marked') return markedChapterIds.has(ch.id);
        return true;
      }),
    })).filter((s) => s.chapters.length > 0);
  }, [subjects, learnFilter, progressByChapter, markedChapterIds]);

  const learnedCount = learnedQuestionCount;
  const unlearnedCount = useMemo(
    () => subjects.reduce((s, sub) => s + sub.count, 0) - learnedQuestionCount,
    [subjects, learnedQuestionCount]
  );
  const markedCount = markedQuestionCount;

  const totalQuestions = useMemo(
    () => subjects.reduce((s, sub) => s + sub.count, 0),
    [subjects]
  );

  const selectedCount = useMemo(
    () => Array.from(selectedChapters).reduce((s, id) => s + (allChapterQIds[id]?.length ?? 0), 0),
    [selectedChapters, allChapterQIds]
  );

  const toggleChapter = (chapterId: string) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const toggleSubject = (subjectId: string) => {
    const subject = subjects.find((s) => s.id === subjectId);
    if (!subject) return;
    const ids = subject.chapters.map((c) => c.id);
    const allSelected = ids.every((id) => selectedChapters.has(id));
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const hasContinue = useMemo(() => {
    const chapters = Array.from(selectedChapters);
    return chapters.some((id) => progressByChapter.has(id));
  }, [selectedChapters, progressByChapter]);

  const continueIndex = useMemo(() => {
    const chapters = Array.from(selectedChapters);
    for (const id of chapters) {
      const p = progressByChapter.get(id);
      if (p) return p.last_question_index + 1;
    }
    return 0;
  }, [selectedChapters, progressByChapter]);

  const handleStart = async (resumeIndex?: number) => {
    if (selectedChapters.size === 0) {
      alert(t('browse.noChapterSelected'));
      return;
    }
    setIsStarting(true);

    const questions = await getQuestionsByChapterIds(Array.from(selectedChapters), 99999);
    const ordered = questionOrder === 'random'
      ? [...questions].sort(() => 0.5 - Math.random())
      : questions;

    const startIndex = resumeIndex ?? 0;
    const sessionId = crypto.randomUUID();
    const session: TestSession = {
      id: sessionId,
      createdAt: Date.now(),
      mode: 'TopicStudy',
      subjects: Array.from(new Set(questions.map((q) => q.subject))),
      chapters: Array.from(selectedChapters),
      questionCount: ordered.length,
      questionIds: ordered.map((q) => q.id),
      userAnswers: {},
      status: 'In-Progress',
      timeSpent: 0,
    };

    const sessions = JSON.parse(localStorage.getItem('passbar_sessions') || '[]');
    sessions.push(session);
    localStorage.setItem('passbar_sessions', JSON.stringify(sessions));
    await saveTestQuestionSnapshot(sessionId, ordered);

    setIsStarting(false);
    router.push(`/test?id=${encodeURIComponent(sessionId)}&startIndex=${startIndex}`);
  };

  return (
    <TooltipProvider delayDuration={120}>
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('browse.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('browse.description')}</p>
        </div>
        <Link href="/footprint">
          <Button variant="outline" className="gap-2">
            <Footprints className="h-4 w-4" />
            {t('nav.footprint')}
          </Button>
        </Link>
      </header>

      {/* 題目順序 */}
      <SettingCard label={t('browse.questionOrder')}>
        <PillToggle
          value={questionOrder}
          onChange={setQuestionOrder}
          options={[
            { value: 'sequential' as const, icon: ListOrdered, label: t('browse.orderSequential') },
            { value: 'random'     as const, icon: Shuffle,     label: t('browse.orderRandom') },
          ]}
        />
      </SettingCard>

      <Accordion type="multiple" defaultValue={['learn-status', 'subjects']} className="space-y-4">

        {/* 學習狀態 */}
        <AccordionItem value="learn-status" className="rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <span className="text-base font-bold text-slate-700">{t('browse.learningStatus')}</span>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-6 pt-4">
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              {([
                { value: 'all'       as const, label: t('browse.filterAll'),       count: totalQuestions, activeClass: 'bg-slate-700 text-white' },
                { value: 'unlearned' as const, label: t('browse.filterUnlearned'), count: unlearnedCount, activeClass: 'bg-primary text-primary-foreground' },
                { value: 'learned'   as const, label: t('browse.filterLearned'),   count: learnedCount,   activeClass: 'bg-green-500 text-white' },
                { value: 'marked'    as const, label: t('browse.filterMarked'),    count: markedCount,    activeClass: 'bg-amber-500 text-white' },
              ]).map(({ value, label, count, activeClass }) => {
                const active = learnFilter === value;
                return (
                  <div key={value} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setLearnFilter(value)}
                      className={cn(
                        'h-4 w-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors',
                        active ? 'border-primary bg-primary' : 'border-slate-300 bg-white'
                      )}
                    >
                      {active && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLearnFilter(value)}
                      className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-600"
                    >
                      {label}
                      <Badge className={cn(
                        'rounded-full border-none px-2 py-0.5 text-xs font-bold transition-colors',
                        count > 0 ? activeClass : 'bg-slate-200 text-slate-400',
                      )}>
                        {count}
                      </Badge>
                    </button>
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 科目與章節 */}
        <AccordionItem value="subjects" className="rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="flex items-center justify-between w-full pr-4">
              <span className="text-base font-bold text-slate-700">{t('browse.selectSubject')}</span>
              {selectedChapters.size > 0 && (
                <span
                  role="button"
                  aria-label={t('create.collapseAll')}
                  onClick={(e) => { e.stopPropagation(); setSelectedChapters(new Set()); }}
                  className="flex items-center justify-center rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedChapters(new Set());
                    }
                  }}
                  tabIndex={0}
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-10 pt-5">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
          {filteredSubjects.map((subject) => {
            const isSelected = subject.chapters.every((c) => selectedChapters.has(c.id));
            const isPartial = subject.chapters.some((c) => selectedChapters.has(c.id)) && !isSelected;
            const subjectLabel = getMbeChineseLabel(subject.name, language);

            return (
              <div key={subject.id} className="space-y-3">
                <div
                  className="flex items-center gap-2 -mx-2 px-2 py-1 rounded-lg cursor-pointer hover:bg-primary/5 transition-colors duration-150"
                  onClick={() => toggleSubject(subject.id)}
                >
                  <Checkbox
                    id={`sub-${subject.id}`}
                    checked={isSelected}
                    onCheckedChange={() => toggleSubject(subject.id)}
                    className={cn('h-5 w-5 pointer-events-none', isPartial && 'opacity-50')}
                  />
                  <Label htmlFor={`sub-${subject.id}`} className="flex min-w-0 cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base font-bold text-slate-700 pointer-events-none">
                    <span>{subject.name}</span>
                    {subjectLabel && <span className="text-sm font-medium text-slate-400">{subjectLabel}</span>}
                    <Badge variant="secondary" className="h-5 rounded-full border-none bg-primary/10 px-2 text-xs font-bold text-primary">
                      {subject.count}
                    </Badge>
                  </Label>
                </div>
                <div className="ml-6 space-y-1">
                  {subject.chapters.map((chapter) => {
                    const chapterLabel = getMbeChineseLabel(chapter.name, language);
                    const progress = progressByChapter.get(chapter.id);
                    const pct = progress && chapter.count > 0
                      ? Math.round((progress.viewed_count / chapter.count) * 100)
                      : 0;
                    return (
                      <div
                        key={chapter.id}
                        className="flex items-center gap-2 -mx-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-primary/5 transition-colors duration-150"
                        onClick={() => toggleChapter(chapter.id)}
                      >
                        <Checkbox
                          id={`ch-${chapter.id}`}
                          checked={selectedChapters.has(chapter.id)}
                          onCheckedChange={() => toggleChapter(chapter.id)}
                          className="h-5 w-5 pointer-events-none"
                        />
                        <Label htmlFor={`ch-${chapter.id}`} className="flex min-w-0 cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium text-slate-500 pointer-events-none">
                          <span>{chapter.name}</span>
                          {chapterLabel && <span className="text-xs font-medium text-slate-400">{chapterLabel}</span>}
                          <Badge variant="outline" className="h-5 rounded-full border-primary/20 bg-primary/5 px-2 text-xs font-bold text-primary">
                            {chapter.count}
                          </Badge>
                          {pct > 0 && (
                            <span className="text-xs text-green-600 font-medium">
                              {t('browse.progressPercent', { percent: pct })}
                            </span>
                          )}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Action bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex-1 text-sm text-slate-500">
          {selectedCount > 0
            ? t('browse.viewed', { count: selectedCount })
            : t('browse.noChapterSelected')}
        </div>
        <div className="flex items-center gap-3">
          {hasContinue && (
            <Button
              variant="outline"
              onClick={() => handleStart(continueIndex)}
              disabled={isStarting}
              className="gap-2"
            >
              <BookOpen className="h-4 w-4" />
              {t('browse.continueAt', { index: continueIndex + 1 })}
            </Button>
          )}
          <Button
            onClick={() => handleStart(0)}
            disabled={isStarting || selectedCount === 0}
            className="h-11 gap-2 px-6 font-semibold"
          >
            {isStarting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
            {t('browse.startBrowse')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
