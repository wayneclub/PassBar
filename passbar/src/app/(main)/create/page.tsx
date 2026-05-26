"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getQuestionsByChapterIds, getSubjects } from '@/lib/question-bank';
import { Subject, TestMode, QuestionSelectionMode, TestSession } from '@/lib/types';
import { emptyQuestionStatusCounts, getQuestionStatusCounts, QuestionStatusCounts } from '@/lib/question-progress';
import { createPracticeSessionRecord } from '@/lib/practice-sessions';
import { Info, HelpCircle, User, Calendar as CalendarIcon, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CreateTestPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const [testDate, setTestDate] = useState('');
  const [testMode, setTestMode] = useState<TestMode>('Tutor');
  const [questionMode, setQuestionMode] = useState<QuestionSelectionMode>('Standard');
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

  useEffect(() => {
    getSubjects().then(setSubjects);
    setTestDate(new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }).format(new Date()));
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
    <div className="mx-auto max-w-6xl space-y-6 pb-28 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-white shadow-sm">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-800">{t('create.title')}</h1>
              <p className="text-sm text-slate-500">PassBar question bank</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <CalendarIcon className="h-4 w-4" />
              <span>{t('create.testDate')} : {testDate || t('create.today')}</span>
            </div>
            <Button variant="ghost" className="gap-2 text-primary">
              <Zap className="h-4 w-4" />
              {t('create.launchTutorial')}
            </Button>
            <User className="h-5 w-5" />
          </div>
        </div>
      </div>

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
        <AccordionItem value="test-mode" className="overflow-hidden rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="flex items-center gap-2 text-base font-bold text-slate-700">
              {t('create.testMode')}
              <Info className="w-3.5 h-3.5 text-primary" />
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

        <AccordionItem value="question-mode" className="overflow-hidden rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="flex items-center gap-2 text-base font-bold text-slate-700">
              {t('create.questionMode')}
              <Info className="w-3.5 h-3.5 text-primary" />
            </div>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-6 pt-4">
            <Tabs 
              value={questionMode} 
              onValueChange={(v) => setQuestionMode(v as QuestionSelectionMode)} 
              className="mb-6 w-[240px]"
            >
              <TabsList className="grid h-10 w-full grid-cols-2">
                <TabsTrigger value="Standard" className="text-sm">{t('create.standard')}</TabsTrigger>
                <TabsTrigger value="Custom" className="text-sm">{t('create.custom')}</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-wrap gap-x-8 gap-y-4 rounded-md bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Checkbox id="filter-unused" checked={statusFilters.Unused} onCheckedChange={() => toggleStatus('Unused')} />
                <Label htmlFor="filter-unused" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-600">
                  {t('create.unused')}
                  <Badge className="rounded-full border-none bg-primary px-2 py-0.5 text-xs font-bold text-white">
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

        <AccordionItem value="subjects" className="overflow-hidden rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
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

        <AccordionItem value="no-questions" className="overflow-hidden rounded-lg border border-slate-200 bg-white px-5 shadow-sm">
          <AccordionTrigger className="py-4 hover:no-underline">
            <div className="text-base font-bold text-slate-700">{t('create.noOfQuestions')}</div>
          </AccordionTrigger>
          <AccordionContent className="border-t pb-6 pt-4">
            <div className="flex items-center gap-4">
              <Input 
                type="text" 
                value={questionCount} 
                onChange={(e) => setQuestionCount(e.target.value)}
                className="h-11 w-28 border-slate-200 bg-slate-50 text-center text-base font-semibold"
              />
              <div className="text-sm text-slate-500">
                {t('create.maxAllowed', { count: currentAvailableQuestions })}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-background/95 px-4 py-4 backdrop-blur md:-mx-8 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-lg md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <div className="text-slate-500">{t('create.selectedChapters')}</div>
              <div className="text-lg font-bold text-slate-800">{selectedChapterCount}</div>
            </div>
            <div>
              <div className="text-slate-500">{t('create.availableQuestions')}</div>
              <div className="text-lg font-bold text-slate-800">{currentAvailableQuestions.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-slate-500">{t('create.totalQuestions')}</div>
              <div className="text-lg font-bold text-slate-800">{totalQuestionCount.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-slate-500">{t('create.readyToGenerate')}</div>
              <div className="text-lg font-bold text-slate-800">{requestedQuestionCount}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <HelpCircle className="h-5 w-5 cursor-pointer text-primary" />
            <Button
              onClick={handleStartTest}
              disabled={isStarting || requestedQuestionCount <= 0}
              className="h-12 min-w-[190px] rounded-md bg-primary px-8 text-base font-bold text-white shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {isStarting ? t('create.generating') : t('create.generateTest')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
