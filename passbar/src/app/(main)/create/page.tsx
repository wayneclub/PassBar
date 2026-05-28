"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/AuthProvider';
import { GuidedTour, GuidedTourStep } from '@/components/GuidedTour';
import { useI18n } from '@/lib/i18n';
import { getQuestionsByChapterIds, getSubjects } from '@/lib/question-bank';
import { Subject, TestMode, TestSession } from '@/lib/types';
import { emptyQuestionStatusCounts, getQuestionStatusCounts, QuestionStatusCounts } from '@/lib/question-progress';
import { createPracticeSessionRecord } from '@/lib/practice-sessions';
import { Info, HelpCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

function HintIcon({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex cursor-help items-center text-primary"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        sideOffset={10}
        className="max-w-[calc(100vw-2rem)] border-slate-200 bg-white p-0 text-slate-600 shadow-xl"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export default function CreateTestPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [testMode, setTestMode] = useState<TestMode>('Tutor');
  const [statusFilters, setStatusFilters] = useState({
    Unused: true,
    Incorrect: false,
    Marked: false,
    Omitted: false,
    Correct: false,
  });
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());
  const [questionCount, setQuestionCount] = useState<string>("0");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [statusCounts, setStatusCounts] = useState<QuestionStatusCounts>(emptyQuestionStatusCounts);
  const [isStarting, setIsStarting] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    getSubjects().then(setSubjects);
  }, []);

  const totalQuestionCount = useMemo(() => (
    subjects.reduce((sum, subject) => sum + subject.count, 0)
  ), [subjects]);

  useEffect(() => {
    if (!user?.id || totalQuestionCount === 0) {
      setStatusCounts({ ...emptyQuestionStatusCounts, Unused: totalQuestionCount });
      return;
    }

    getQuestionStatusCounts(user.id, totalQuestionCount).then(setStatusCounts);
  }, [user?.id, totalQuestionCount]);

  const currentAvailableQuestions = useMemo(() => {
    let count = 0;
    subjects.forEach(subject => {
      subject.chapters.forEach(chapter => {
        if (selectedChapters.has(chapter.id)) {
          count += chapter.count;
        }
      });
    });
    return count;
  }, [subjects, selectedChapters]);
  const selectedChapterCount = selectedChapters.size;
  const requestedQuestionCount = Number.parseInt(questionCount, 10) || 0;
  const practicedQuestionCount = statusCounts.Correct + statusCounts.Incorrect;
  const unpracticedQuestionCount = Math.max(totalQuestionCount - practicedQuestionCount, 0);
  const tourSteps = useMemo<GuidedTourStep[]>(() => [
    {
      selector: '[data-tour="qbank"]',
      title: t('tour.qbankTitle'),
      description: t('tour.qbankDescription'),
    },
    {
      selector: '[data-tour="create-test"]',
      title: t('tour.createTestTitle'),
      description: t('tour.createTestDescription'),
    },
    {
      selector: '[data-tour="test-mode"]',
      title: t('tour.testModeTitle'),
      description: t('tour.testModeDescription'),
    },
    {
      selector: '[data-tour="question-mode"]',
      title: t('tour.questionModeTitle'),
      description: t('tour.questionModeDescription'),
    },
    {
      selector: '[data-tour="subjects"]',
      title: t('tour.subjectsTitle'),
      description: t('tour.subjectsDescription'),
    },
    {
      selector: '[data-tour="generate"]',
      title: t('tour.generateTitle'),
      description: t('tour.generateDescription'),
    },
  ], [t]);

  useEffect(() => {
    setQuestionCount(currentAvailableQuestions.toString());
  }, [currentAvailableQuestions]);

  const toggleStatus = (status: keyof typeof statusFilters) => {
    setStatusFilters(prev => ({ ...prev, [status]: !prev[status] }));
  };

  const toggleChapter = (chapterId: string) => {
    setSelectedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const toggleSubject = (subjectId: string) => {
    const subject = subjects.find(s => s.id === subjectId);
    if (!subject) return;

    const chapterIds = subject.chapters.map(c => c.id);
    const allSelected = chapterIds.every(id => selectedChapters.has(id));

    setSelectedChapters(prev => {
      const next = new Set(prev);
      if (allSelected) {
        chapterIds.forEach(id => next.delete(id));
      } else {
        chapterIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleStartTest = async () => {
    const count = parseInt(questionCount);
    if (isNaN(count) || count <= 0) {
      alert(t('create.selectChapterAlert'));
      return;
    }

    setIsStarting(true);
    const matchingQuestions = await getQuestionsByChapterIds(Array.from(selectedChapters), count);
    const shuffled = [...matchingQuestions].sort(() => 0.5 - Math.random());
    const selectedIds = shuffled.map(q => q.id);

    if (selectedIds.length === 0) {
      setIsStarting(false);
      alert(t('create.noQuestionsAlert'));
      return;
    }

    const subjectNames = Array.from(new Set(matchingQuestions.map(q => q.subject)));
    const chapterIds = Array.from(selectedChapters);
    const dbSessionId = user?.id
      ? await createPracticeSessionRecord({
        userId: user.id,
        mode: testMode,
        subjectNames,
        chapterIds,
        questionIds: selectedIds,
      })
      : null;

    const newSession: TestSession = {
      id: dbSessionId ?? crypto.randomUUID(),
      createdAt: Date.now(),
      mode: testMode,
      subjects: subjectNames,
      chapters: chapterIds,
      questionCount: selectedIds.length,
      questionIds: selectedIds, 
      userAnswers: {},
      status: 'In-Progress',
      timeSpent: 0
    };

    const sessions = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
    sessions.push(newSession);
    localStorage.setItem('passbar_sessions', JSON.stringify(sessions));

    setIsStarting(false);
    router.push(`/test?id=${encodeURIComponent(newSession.id)}`);
  };

  return (
    <TooltipProvider delayDuration={120}>
    <div className="mx-auto max-w-6xl space-y-6 pb-28 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-4xl font-bold text-primary">{t('create.title')}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <Button variant="ghost" className="gap-2 text-primary" onClick={() => setTourOpen(true)}>
            <Zap className="h-4 w-4" />
            {t('create.launchTutorial')}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-slate-500">{t('create.totalQuestions')}</div>
          <div className="mt-2 text-3xl font-bold text-slate-800">{totalQuestionCount.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-slate-500">{t('create.practicedQuestions')}</div>
          <div className="mt-2 text-3xl font-bold text-primary">{practicedQuestionCount.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-slate-500">{t('create.unpracticedQuestions')}</div>
          <div className="mt-2 text-3xl font-bold text-slate-800">{unpracticedQuestionCount.toLocaleString()}</div>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={['test-mode', 'question-mode', 'subjects', 'no-questions']} className="space-y-4">
        <AccordionItem value="test-mode" data-tour="test-mode" className="rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="flex items-center gap-2 text-base font-bold text-slate-700">
              {t('create.testMode')}
              <HintIcon>
                <div className="w-[min(28rem,calc(100vw-2rem))] p-1">
                  <p className="px-4 py-3 text-sm leading-relaxed text-slate-500">{t('create.testModeHint')}</p>
                  <div className="grid grid-cols-[5rem_1fr] gap-4 border-t border-slate-200 px-4 py-3">
                    <div className="font-bold text-slate-700">{t('create.tutor')}</div>
                    <div>{t('create.tutorModeHint')}</div>
                  </div>
                  <div className="grid grid-cols-[5rem_1fr] gap-4 border-t border-slate-200 px-4 py-3">
                    <div className="font-bold text-slate-700">{t('create.timed')}</div>
                    <div>{t('create.timedModeHint')}</div>
                  </div>
                </div>
              </HintIcon>
            </div>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-6 pt-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <Switch 
                  id="mode-switch" 
                  checked={testMode === 'Timed'} 
                  onCheckedChange={(checked) => setTestMode(checked ? 'Timed' : 'Tutor')}
                />
                <div className="flex gap-4 text-base font-medium">
                  <span className={cn(testMode === 'Tutor' ? "text-primary" : "text-slate-400")}>{t('create.tutor')}</span>
                  <span className={cn(testMode === 'Timed' ? "text-primary" : "text-slate-400")}>{t('create.timed')}</span>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="question-mode" data-tour="question-mode" className="rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="flex items-center gap-2 text-base font-bold text-slate-700">
              {t('create.questionMode')}
              <HintIcon>
                <div className="w-[min(40rem,calc(100vw-2rem))] p-1">
                  <p className="px-4 py-3 text-sm leading-relaxed text-slate-500">{t('create.questionModeHint')}</p>
                  {[
                    ['create.unused', 'create.unusedHint'],
                    ['create.incorrect', 'create.incorrectHint'],
                    ['create.marked', 'create.markedHint'],
                    ['create.omitted', 'create.omittedHint'],
                    ['create.correct', 'create.correctHint'],
                  ].map(([labelKey, hintKey]) => (
                    <div key={labelKey} className="grid grid-cols-[7rem_1fr] gap-4 border-t border-slate-200 px-4 py-3">
                      <div className="font-bold text-slate-700">{t(labelKey as Parameters<typeof t>[0])}</div>
                      <div>{t(hintKey as Parameters<typeof t>[0])}</div>
                    </div>
                  ))}
                </div>
              </HintIcon>
            </div>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-6 pt-4">
            <div className="flex flex-wrap gap-x-8 gap-y-4 rounded-md bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Checkbox id="filter-unused" checked={statusFilters.Unused} onCheckedChange={() => toggleStatus('Unused')} />
                <Label htmlFor="filter-unused" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-600">
                  {t('create.unused')}
                  <Badge className="rounded-full border-none bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                    {statusCounts.Unused}
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-incorrect" checked={statusFilters.Incorrect} onCheckedChange={() => toggleStatus('Incorrect')} />
                <Label htmlFor="filter-incorrect" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-600">
                  {t('create.incorrect')}
                  <Badge className="rounded-full border-none bg-slate-300 px-2 py-0.5 text-xs font-bold text-white">
                    {statusCounts.Incorrect}
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-marked" checked={statusFilters.Marked} onCheckedChange={() => toggleStatus('Marked')} />
                <Label htmlFor="filter-marked" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-600">
                  {t('create.marked')}
                  <Badge className="rounded-full border-none bg-slate-300 px-2 py-0.5 text-xs font-bold text-white">
                    {statusCounts.Marked}
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-omitted" checked={statusFilters.Omitted} onCheckedChange={() => toggleStatus('Omitted')} />
                <Label htmlFor="filter-omitted" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-600">
                  {t('create.omitted')}
                  <Badge className="rounded-full border-none bg-slate-300 px-2 py-0.5 text-xs font-bold text-white">
                    {statusCounts.Omitted}
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-correct" checked={statusFilters.Correct} onCheckedChange={() => toggleStatus('Correct')} />
                <Label htmlFor="filter-correct" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-600">
                  {t('create.correct')}
                  <Badge className="rounded-full border-none bg-slate-300 px-2 py-0.5 text-xs font-bold text-white">
                    {statusCounts.Correct}
                  </Badge>
                </Label>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="subjects" data-tour="subjects" className="rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="flex items-center justify-between w-full pr-4">
              <div className="flex items-center gap-2 text-base font-bold text-slate-700">
                {t('create.subjectsAndChapters')}
              </div>
              <div className="flex items-center gap-4 text-sm font-semibold text-primary">
                <span 
                  className="cursor-pointer hover:underline" 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setSelectedChapters(new Set()); 
                  }}
                >
                  {t('create.collapseAll')}
                </span>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-10 pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              {subjects.map((subject) => {
                const isSelected = subject.chapters.every(c => selectedChapters.has(c.id));
                const isPartiallySelected = subject.chapters.some(c => selectedChapters.has(c.id)) && !isSelected;

                return (
                  <div key={subject.id} className="space-y-3">
                    <div className="flex items-center gap-2 group">
                      <Checkbox 
                        id={subject.id} 
                        checked={isSelected}
                        onCheckedChange={() => toggleSubject(subject.id)}
                        className={cn("h-5 w-5", isPartiallySelected && "opacity-50")}
                      />
                      <Label htmlFor={subject.id} className="flex cursor-pointer items-center gap-2 text-base font-bold text-slate-700">
                        {subject.name}
                        <Badge variant="secondary" className="h-5 rounded-full border-none bg-primary/10 px-2 text-xs font-bold text-primary hover:bg-primary/15">
                          {subject.count}
                        </Badge>
                      </Label>
                    </div>
                    
                    <div className="ml-6 space-y-2">
                      {subject.chapters.map((chapter) => (
                        <div key={chapter.id} className="flex items-center gap-2">
                          <Checkbox 
                            id={chapter.id} 
                            checked={selectedChapters.has(chapter.id)}
                            onCheckedChange={() => toggleChapter(chapter.id)}
                            className="h-5 w-5"
                          />
                          <Label htmlFor={chapter.id} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-500">
                            {chapter.name}
                            <Badge variant="outline" className="h-5 rounded-full border-primary/20 bg-primary/5 px-2 text-xs font-bold text-primary">
                              {chapter.count}
                            </Badge>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="no-questions" data-tour="generate" className="rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="text-base font-bold text-slate-700">{t('create.noOfQuestions')}</div>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-6 pt-5">
            <div className="flex flex-col gap-6">

              {/* Input + availability */}
              <div className="flex flex-wrap items-center gap-3 py-1">
                <Input
                  type="text"
                  value={questionCount}
                  onChange={(e) => setQuestionCount(e.target.value)}
                  className="h-12 w-32 border border-slate-300 bg-white text-center text-xl font-bold rounded-lg shadow-sm hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white transition-all duration-200"
                />
                <span className="text-sm text-slate-500">
                  {t('create.maxAllowed', { count: currentAvailableQuestions })}
                </span>
              </div>

              {/* Stats + Action */}
              <div className="flex flex-col md:flex-row md:items-end gap-5">
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 flex-1">
                  {[
                    { label: t('create.selectedChapters'), value: selectedChapterCount, highlight: false },
                    { label: t('create.availableQuestions'), value: currentAvailableQuestions.toLocaleString(), highlight: false },
                    { label: t('create.totalQuestions'), value: totalQuestionCount.toLocaleString(), highlight: false },
                    { label: t('create.readyToGenerate'), value: requestedQuestionCount, highlight: true },
                  ].map((stat, idx) => (
                    <div key={idx} className="flex flex-col gap-0.5">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{stat.label}</div>
                      <div className={cn("text-2xl font-bold", stat.highlight ? "text-primary" : "text-slate-800")}>{stat.value}</div>
                    </div>
                  ))}
                </div>

                {/* Action */}
                <div className="flex items-center gap-3 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-primary/75 hover:text-primary transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <HelpCircle className="h-5 w-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px] text-xs">
                      {t('tour.generateDescription')}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    onClick={handleStartTest}
                    disabled={isStarting || requestedQuestionCount <= 0}
                    className="h-12 w-full md:w-auto min-w-[160px] rounded-xl bg-primary px-8 text-base font-bold text-primary-foreground shadow-md hover:bg-primary/95 active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                  >
                    {isStarting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
                    <span>{isStarting ? t('create.generating') : t('create.generateTest')}</span>
                  </Button>
                </div>
              </div>

            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <GuidedTour
        open={tourOpen}
        steps={tourSteps}
        onOpenChange={setTourOpen}
        stepLabel={(current, total) => t('tour.stepOf', { current, total })}
        backLabel={t('tour.back')}
        nextLabel={t('tour.next')}
        doneLabel={t('tour.done')}
      />
    </div>
    </TooltipProvider>
  );
}
