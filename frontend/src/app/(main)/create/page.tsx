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
import { getQuestionsByChapterIds, getSubjects } from '@/lib/question-bank';
import { Subject, TestMode, QuestionSelectionMode, TestSession } from '@/lib/types';
import { Info, HelpCircle, User, Calendar as CalendarIcon, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CreateTestPage() {
  const router = useRouter();
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
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    getSubjects().then(setSubjects);
  }, []);

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
      alert("Please select at least one chapter with questions.");
      return;
    }

    setIsStarting(true);
    const matchingQuestions = await getQuestionsByChapterIds(Array.from(selectedChapters), count);
    const shuffled = [...matchingQuestions].sort(() => 0.5 - Math.random());
    const selectedIds = shuffled.map(q => q.id);
    setIsStarting(false);

    if (selectedIds.length === 0) {
      alert("No questions found for the selected chapters. Check your Supabase import or choose a chapter with local fallback data.");
      return;
    }

    const newSession: TestSession = {
      id: Math.random().toString(36).substring(7),
      createdAt: Date.now(),
      mode: testMode,
      subjects: Array.from(new Set(matchingQuestions.map(q => q.subject))), 
      chapters: Array.from(selectedChapters),
      questionCount: selectedIds.length,
      questionIds: selectedIds, 
      userAnswers: {},
      status: 'In-Progress',
      timeSpent: 0
    };

    const sessions = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
    sessions.push(newSession);
    localStorage.setItem('passbar_sessions', JSON.stringify(sessions));

    router.push(`/test/${newSession.id}`);
  };

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8 border-b pb-4">
        <div className="flex items-center gap-4">
          <div className="bg-primary p-2 rounded">
            <Zap className="text-white w-5 h-5" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-700">Create Test</h1>
        </div>
        <div className="flex items-center gap-6 text-slate-400">
          <div className="flex items-center gap-2 text-sm">
            <CalendarIcon className="w-4 h-4" />
            <span>Test Date : Mar 11, 2026</span>
          </div>
          <User className="w-5 h-5 cursor-pointer" />
        </div>
      </div>

      <div className="flex justify-end mb-4">
        <Button variant="ghost" className="text-primary text-xs flex items-center gap-1 font-semibold">
          <Zap className="w-3 h-3" />
          Launch Tutorial
        </Button>
      </div>

      <Accordion type="multiple" defaultValue={['test-mode', 'question-mode', 'subjects', 'no-questions']} className="space-y-4">
        <AccordionItem value="test-mode" className="border rounded-md px-4 bg-white shadow-sm overflow-hidden">
          <AccordionTrigger className="hover:no-underline py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
              Test Mode
              <Info className="w-3.5 h-3.5 text-primary" />
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6 border-t">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <Switch 
                  id="mode-switch" 
                  checked={testMode === 'Timed'} 
                  onCheckedChange={(checked) => setTestMode(checked ? 'Timed' : 'Tutor')}
                />
                <div className="flex gap-4 text-sm font-medium">
                  <span className={cn(testMode === 'Tutor' ? "text-primary" : "text-slate-400")}>Tutor</span>
                  <span className={cn(testMode === 'Timed' ? "text-primary" : "text-slate-400")}>Timed</span>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="question-mode" className="border rounded-md px-4 bg-white shadow-sm overflow-hidden">
          <AccordionTrigger className="hover:no-underline py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
              Question Mode
              <Info className="w-3.5 h-3.5 text-primary" />
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-6 border-t">
            <Tabs 
              value={questionMode} 
              onValueChange={(v) => setQuestionMode(v as QuestionSelectionMode)} 
              className="w-[200px] mb-6"
            >
              <TabsList className="grid w-full grid-cols-2 h-8">
                <TabsTrigger value="Standard" className="text-xs">Standard</TabsTrigger>
                <TabsTrigger value="Custom" className="text-xs">Custom</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <div className="flex items-center gap-2">
                <Checkbox id="filter-unused" checked={statusFilters.Unused} onCheckedChange={() => toggleStatus('Unused')} />
                <Label htmlFor="filter-unused" className="text-xs font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
                  Unused
                  <Badge className="px-2 py-0.5 rounded-full text-[10px] text-white font-bold border-none bg-primary">
                    1382
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-incorrect" checked={statusFilters.Incorrect} onCheckedChange={() => toggleStatus('Incorrect')} />
                <Label htmlFor="filter-incorrect" className="text-xs font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
                  Incorrect
                  <Badge className="px-2 py-0.5 rounded-full text-[10px] text-white font-bold border-none bg-slate-300">
                    37
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-marked" checked={statusFilters.Marked} onCheckedChange={() => toggleStatus('Marked')} />
                <Label htmlFor="filter-marked" className="text-xs font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
                  Marked
                  <Badge className="px-2 py-0.5 rounded-full text-[10px] text-white font-bold border-none bg-slate-300">
                    0
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-omitted" checked={statusFilters.Omitted} onCheckedChange={() => toggleStatus('Omitted')} />
                <Label htmlFor="filter-omitted" className="text-xs font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
                  Omitted
                  <Badge className="px-2 py-0.5 rounded-full text-[10px] text-white font-bold border-none bg-slate-300">
                    445
                  </Badge>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-correct" checked={statusFilters.Correct} onCheckedChange={() => toggleStatus('Correct')} />
                <Label htmlFor="filter-correct" className="text-xs font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer">
                  Correct
                  <Badge className="px-2 py-0.5 rounded-full text-[10px] text-white font-bold border-none bg-slate-300">
                    67
                  </Badge>
                </Label>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="subjects" className="border rounded-md px-4 bg-white shadow-sm overflow-hidden">
          <AccordionTrigger className="hover:no-underline py-3">
            <div className="flex items-center justify-between w-full pr-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                Subjects and Chapters
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold text-primary">
                <span 
                  className="cursor-pointer hover:underline" 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setSelectedChapters(new Set()); 
                  }}
                >
                  Collapse All
                </span>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-4 pb-10 border-t">
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
                        className={cn("w-4 h-4", isPartiallySelected && "opacity-50")}
                      />
                      <Label htmlFor={subject.id} className="text-sm font-bold text-slate-600 flex items-center gap-2 cursor-pointer">
                        {subject.name}
                        <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/15 border-none h-4 px-2 text-[9px] font-bold rounded-full">
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
                            className="w-4 h-4"
                          />
                          <Label htmlFor={chapter.id} className="text-[12px] font-medium text-slate-500 flex items-center gap-2 cursor-pointer">
                            {chapter.name}
                            <Badge variant="outline" className="text-primary border-primary/20 bg-primary/5 h-4 px-2 text-[9px] font-bold rounded-full">
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

        <AccordionItem value="no-questions" className="border rounded-md px-4 bg-white shadow-sm overflow-hidden">
          <AccordionTrigger className="hover:no-underline py-3">
            <div className="text-sm font-bold text-slate-700">No. of Questions</div>
          </AccordionTrigger>
          <AccordionContent className="pt-4 pb-6 border-t">
            <div className="flex items-center gap-4">
              <Input 
                type="text" 
                value={questionCount} 
                onChange={(e) => setQuestionCount(e.target.value)}
                className="w-20 h-8 text-center text-xs bg-slate-50 border-slate-200"
              />
              <div className="text-[11px] text-slate-500">
                Max allowed based on selection: <span className="font-bold">{currentAvailableQuestions}</span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="mt-8 flex items-center gap-4">
        <Button 
          onClick={handleStartTest}
          disabled={isStarting}
          className="bg-sky-200 hover:bg-sky-300 text-slate-700 font-bold text-xs px-6 py-2 h-auto uppercase tracking-wide border-none rounded-none"
        >
          {isStarting ? 'Generating...' : 'Generate Test'}
        </Button>
        <HelpCircle className="w-4 h-4 text-primary cursor-pointer" />
      </div>

      <footer className="mt-20 pt-4 border-t text-center">
        <p className="text-[10px] text-slate-400">
          PassBar question bank
        </p>
      </footer>
    </div>
  );
}
