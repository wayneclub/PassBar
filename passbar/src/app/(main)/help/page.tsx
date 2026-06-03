"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { getSubjects } from '@/lib/question-bank';
import type { Subject } from '@/lib/types';
import { Play, Pause, RefreshCw, Search, ChevronDown, Send, Check, X, Clock, Zap } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

type FaqCategory = 'all' | 'tech' | 'feature' | 'exam';
type FeedbackCategory = 'content' | 'bug' | 'feature';

// ─── Shared timer hook ────────────────────────────────────────────────────────

const PACING_SECONDS = 108;

function usePacingTimer(onEnd: () => void) {
  const [timeLeft, setTimeLeft] = useState(PACING_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const reset = useCallback(() => { stop(); setRunning(false); setTimeLeft(PACING_SECONDS); }, [stop]);
  const toggle = useCallback(() => setRunning((r) => !r), []);

  useEffect(() => {
    if (!running) { stop(); return; }
    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          stop();
          setRunning(false);
          setTimeout(() => { onEndRef.current(); setTimeLeft(PACING_SECONDS); }, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return stop;
  }, [running, stop]);

  return { timeLeft, running, toggle, reset };
}

// ─── Interactive Step Guide ───────────────────────────────────────────────────

type MockAnswer = 'A' | 'B' | 'C' | 'D' | null;

// Demo subject/chapter data — 2 subjects for sandbox illustration
const DEMO_SUBJECTS = [
  {
    id: 'civil-procedure', name: 'Civil Procedure', total: 168,
    chapters: [
      { id: 'cp-pleading',  name: 'Pleading & Parties', count: 38 },
      { id: 'cp-discovery', name: 'Discovery',           count: 34 },
      { id: 'cp-motions',   name: 'Pretrial Motions',   count: 44 },
      { id: 'cp-trial',     name: 'Trial & Judgment',   count: 30 },
      { id: 'cp-appeal',    name: 'Appeals',             count: 22 },
    ],
  },
  {
    id: 'contracts', name: 'Contracts', total: 154,
    chapters: [
      { id: 'ct-formation',     name: 'Formation',            count: 42 },
      { id: 'ct-consideration', name: 'Consideration',        count: 30 },
      { id: 'ct-performance',   name: 'Performance & Breach', count: 44 },
      { id: 'ct-remedies',      name: 'Remedies',             count: 38 },
    ],
  },
];

type DemoTestMode = 'Tutor' | 'Timed' | 'Browse';

function InteractiveStepGuide() {
  const { toast } = useToast();
  const { t } = useI18n();
  const [activeStep, setActiveStep] = useState(1);
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set(['cp-pleading', 'cp-discovery', 'cp-motions', 'cp-trial', 'cp-appeal']))
;
  const [questionCount, setQuestionCount] = useState(20);
  const [testMode, setTestMode] = useState<DemoTestMode>('Tutor');
  const [mockAnswer, setMockAnswer] = useState<MockAnswer>(null);


  // Timer — lives inside the guide, shown in step 2
  const { timeLeft, running, toggle: toggleTimer, reset: resetTimer } = usePacingTimer(() => {
    toast({ title: t('help.timerDoneToast') });
  });
  const timerMins = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const timerSecs = String(timeLeft % 60).padStart(2, '0');
  const timerWarning = timeLeft <= 15 && running;

  // Auto-start timer when entering step 2, stop when leaving
  const handleSetStep = useCallback((num: number) => {
    setActiveStep(num);
    if (num === 2) {
      resetTimer();
      // start on next tick so reset completes first
      setTimeout(() => toggleTimer(), 0);
    } else {
      resetTimer();
    }
    setMockAnswer(null);
  }, [resetTimer, toggleTimer]);

  const toggleChapter = (chapterId: string) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId);
      return next;
    });
  };

  const toggleSubjectAll = (subjectId: string) => {
    const subject = DEMO_SUBJECTS.find((s) => s.id === subjectId);
    if (!subject) return;
    const allSelected = subject.chapters.every((c) => selectedChapters.has(c.id));
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (allSelected) subject.chapters.forEach((c) => next.delete(c.id));
      else subject.chapters.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const totalSelected = DEMO_SUBJECTS.flatMap((s) => s.chapters)
    .filter((c) => selectedChapters.has(c.id))
    .reduce((sum, c) => sum + c.count, 0);

  const testModes: { key: DemoTestMode; label: string; desc: string }[] = [
    { key: 'Tutor',  label: 'Tutor',  desc: t('help.demoTutorDesc') },
    { key: 'Timed',  label: 'Timed',  desc: t('help.demoTimedDesc') },
    { key: 'Browse', label: 'Browse', desc: t('help.demoBrowseDesc') },
  ];

  const steps = [
    { num: 1, title: t('help.step1Title'), desc: t('help.step1Desc') },
    { num: 2, title: t('help.step2Title'), desc: t('help.step2Desc') },
    { num: 3, title: t('help.step3Title'), desc: t('help.step3Desc') },
  ];

  const MOCK_OPTIONS: { key: MockAnswer; text: string }[] = [
    { key: 'A', text: 'It must be filed within 14 days of trial.' },
    { key: 'B', text: 'It may be filed at any time until 30 days after close of discovery.' },
    { key: 'C', text: 'It must be supported by admissible oral testimony.' },
    { key: 'D', text: 'The opposing party bears the burden of proving a genuine dispute of material fact.' },
  ];

  const REVIEW_OPTIONS: { key: string; text: string; state: 'correct' | 'wrong-selected' | 'neutral' }[] = [
    { key: 'A', text: 'It must be filed within 14 days of trial.',                                                    state: 'wrong-selected' },
    { key: 'B', text: 'It may be filed at any time until 30 days after close of discovery.',                          state: 'correct'        },
    { key: 'C', text: 'It must be supported by admissible oral testimony.',                                            state: 'neutral'        },
    { key: 'D', text: 'The opposing party bears the burden of proving a genuine dispute of material fact.',            state: 'neutral'        },
  ];

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-0">
        {/* ── Step nav (left) ── */}
        <div className="md:col-span-4 flex flex-col gap-2 p-5 border-b md:border-b-0 md:border-r border-border">
          {steps.map((step) => {
            const isActive = activeStep === step.num;
            return (
              <button
                key={step.num}
                onClick={() => handleSetStep(step.num)}
                className={cn(
                  'w-full text-left p-3.5 rounded-xl border transition-all duration-200 flex items-start gap-3',
                  isActive ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
                )}
              >
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}>
                  {step.num}
                </div>
                <div>
                  <p className={cn('font-semibold text-xs', isActive ? 'text-primary' : 'text-foreground')}>{step.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Sandbox (right) ── */}
        <div className="md:col-span-8 flex flex-col">

          {/* ────── Panel 1: Build test — mirrors Create Test page ────── */}
          {activeStep === 1 && (
            <div className="flex flex-col">
              {/* Test mode selector */}
              <div className="px-5 pt-4 pb-3 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground mb-2">{t('help.questionMode')}</p>
                <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 p-1">
                  {testModes.map(({ key, label, desc }) => (
                    <button
                      key={key}
                      onClick={() => setTestMode(key)}
                      title={desc}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150',
                        testMode === key
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}>
                      {label}
                    </button>
                  ))}
                </div>
                {testMode && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 ml-1">
                    {testModes.find((m) => m.key === testMode)?.desc}
                  </p>
                )}
              </div>

              {/* Subject + chapter list */}
              <div className="p-5 overflow-y-auto max-h-[340px]">
                <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                  {DEMO_SUBJECTS.map((subject) => {
                    const allSel = subject.chapters.every((c) => selectedChapters.has(c.id));
                    const partialSel = subject.chapters.some((c) => selectedChapters.has(c.id)) && !allSel;
                    const selCount = subject.chapters.filter((c) => selectedChapters.has(c.id))
                      .reduce((s, c) => s + c.count, 0);
                    return (
                      <div key={subject.id} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={subject.id}
                            checked={allSel}
                            className={cn('h-4 w-4', partialSel && 'opacity-60')}
                            onCheckedChange={() => toggleSubjectAll(subject.id)}
                          />
                          <Label htmlFor={subject.id} className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800 dark:text-foreground">
                            {subject.name}
                            <Badge className="rounded-full border-none bg-primary/10 px-2 py-0 text-xs font-bold text-primary">
                              {selCount > 0 ? selCount : subject.total}
                            </Badge>
                          </Label>
                        </div>
                        <div className="ml-6 space-y-1.5">
                          {subject.chapters.map((chapter) => (
                            <div key={chapter.id} className="flex items-center gap-2">
                              <Checkbox
                                id={chapter.id}
                                checked={selectedChapters.has(chapter.id)}
                                className="h-4 w-4"
                                onCheckedChange={() => toggleChapter(chapter.id)}
                              />
                              <Label htmlFor={chapter.id} className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-muted-foreground">
                                {chapter.name}
                                <Badge variant="secondary" className="rounded-full border-none bg-slate-100 dark:bg-muted px-1.5 py-0 text-[10px] font-semibold text-slate-400">
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
              </div>

              {/* Footer */}
              <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-3 bg-muted/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    {t('help.selectedAvailablePrefix')} <span className="font-bold text-foreground">{totalSelected}</span> {t('help.selectedAvailableSuffix')}
                  </span>
                  <span className="text-muted-foreground/30">·</span>
                  <Label className="text-xs text-muted-foreground shrink-0">{t('help.generateCountLabel')}</Label>
                  <Input
                    type="number" min={1} max={totalSelected || 200}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Math.max(1, Math.min(totalSelected || 200, Number(e.target.value) || 1)))}
                    className="w-16 h-7 text-xs text-center px-1"
                  />
                  <span className="text-xs text-muted-foreground">{t('help.questionsUnit')}</span>
                </div>
                <Button size="sm" className="shrink-0"
                  disabled={selectedChapters.size === 0}
                  onClick={() => toast({ title: t('help.createdMockTestToast', { mode: testMode, count: questionCount }) })}>
                  {t('help.createMockTest')}
                </Button>
              </div>
            </div>
          )}

          {/* ────── Panel 2: Mock question + embedded timer ────── */}
          {activeStep === 2 && (
            <div className="flex flex-col">
              {/* Dark timer strip — three-column layout */}
              <div className="bg-secondary text-white grid grid-cols-3 items-center px-5 py-3 gap-2">
                {/* Left: label */}
                <div>
                  <span className="text-[10px] font-bold tracking-widest text-primary uppercase">MBE PACING</span>
                </div>

                {/* Center: fixed demo subjects */}
                <div className="flex flex-wrap justify-center gap-1.5">
                  {(['Civil Procedure', 'Motions'] as const).map((s) => (
                    <span key={s} className="text-[10px] font-medium bg-white/10 text-white/80 px-2 py-0.5 rounded-full">
                      {s}
                    </span>
                  ))}
                </div>

                {/* Right: countdown + reset */}
                <div className="flex items-center justify-end gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                    running ? 'bg-green-400 animate-ping' : 'bg-red-400')} />
                  <span className={cn('text-xl font-mono font-bold tabular-nums transition-colors',
                    timerWarning ? 'text-red-400 animate-pulse' : 'text-primary')}>
                    {timerMins}:{timerSecs}
                  </span>
                  <button onClick={() => { resetTimer(); setTimeout(() => toggleTimer(), 0); }}
                    className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                    title={t('help.resetTimer')}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Question text */}
              <div className="px-5 pt-4 pb-2">
                <p className="text-sm font-bold text-slate-900 dark:text-foreground leading-relaxed">
                  Q. Which of the following is most accurate regarding a motion for summary judgment?
                </p>
              </div>

              {/* Options — empty radio circle (no letter inside) */}
              <div className="px-4 pb-3 space-y-1">
                {MOCK_OPTIONS.map(({ key, text }) => {
                  const selected = mockAnswer === key;
                  const isCorrect = key === 'B';
                  const revealed = mockAnswer !== null;
                  return (
                    <button key={key}
                      onClick={() => { setMockAnswer(key); toast({ title: isCorrect ? t('help.correctToast') : t('help.incorrectToast') }); }}
                      className={cn(
                        'w-full flex items-start gap-2 sm:gap-3 py-3 px-2 sm:px-3 rounded-lg border transition-colors text-left',
                        revealed && isCorrect ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'
                          : revealed && selected && !isCorrect ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                            : 'border-transparent hover:bg-slate-50 dark:hover:bg-muted/50',
                      )}>
                      {/* Empty radio circle (✓/✗ when revealed) */}
                      <span className={cn(
                        'mt-[3px] w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors',
                        revealed && isCorrect ? 'border-green-500 bg-green-500 text-white'
                          : revealed && selected && !isCorrect ? 'border-red-500 bg-red-500 text-white'
                            : selected ? 'border-primary bg-primary/10'
                              : 'border-slate-300 dark:border-border',
                      )}>
                        {revealed && isCorrect && <Check className="w-3 h-3" strokeWidth={3} />}
                        {revealed && selected && !isCorrect && <X className="w-3 h-3" strokeWidth={3} />}
                      </span>
                      {/* Letter label */}
                      <span className={cn('shrink-0 font-bold text-sm mt-0.5',
                        revealed && isCorrect ? 'text-green-700 dark:text-green-400'
                          : revealed && selected ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-900 dark:text-foreground')}>
                        {key}.
                      </span>
                      {/* Option text */}
                      <span className={cn('text-sm leading-relaxed mt-0.5',
                        (revealed && (isCorrect || selected)) ? 'font-medium text-slate-900 dark:text-foreground'
                          : 'font-normal text-slate-700 dark:text-muted-foreground')}>
                        {text}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Result card */}
              {mockAnswer !== null && (
                <div className={cn('mx-4 mb-4 border bg-white dark:bg-card p-3.5 rounded-lg shadow-sm border-l-4 flex items-start gap-3',
                  mockAnswer === 'B' ? 'border-l-green-500 border-green-200' : 'border-l-red-500 border-red-200')}>
                  <div className={cn('mt-0.5 shrink-0', mockAnswer === 'B' ? 'text-green-600' : 'text-red-600')}>
                    {mockAnswer === 'B' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className={cn('text-sm font-semibold', mockAnswer === 'B' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                      {mockAnswer === 'B' ? t('help.answerCorrect') : t('help.answerIncorrect')}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t('help.correctAnswerLabel')} <span className="font-bold text-slate-900 dark:text-foreground">B</span> Rule 56(b) — 30 days after close of discovery
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ────── Panel 3: Review + explanation (always visible) ────── */}
          {activeStep === 3 && (
            <div className="flex flex-col">
              {/* Question */}
              <div className="px-5 pt-5 pb-2">
                <p className="text-sm font-bold text-slate-900 dark:text-foreground leading-relaxed">
                  Q. Which of the following is most accurate regarding a motion for summary judgment?
                </p>
              </div>

              {/* Options — revealed, same empty-radio style */}
              <div className="px-4 pb-3 space-y-1">
                {REVIEW_OPTIONS.map(({ key, text, state }) => (
                  <div key={key} className={cn(
                    'flex items-start gap-2 sm:gap-3 py-3 px-2 sm:px-3 rounded-lg border',
                    state === 'correct' ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'
                      : state === 'wrong-selected' ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                        : 'border-transparent',
                  )}>
                    {/* Empty radio — filled on correct/wrong */}
                    <span className={cn(
                      'mt-[3px] w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2',
                      state === 'correct' ? 'border-green-500 bg-green-500 text-white'
                        : state === 'wrong-selected' ? 'border-red-500 bg-red-500 text-white'
                          : 'border-slate-300 dark:border-border',
                    )}>
                      {state === 'correct' && <Check className="w-3 h-3" strokeWidth={3} />}
                      {state === 'wrong-selected' && <X className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <span className={cn('shrink-0 font-bold text-sm mt-0.5',
                      state === 'correct' ? 'text-green-700 dark:text-green-400'
                        : state === 'wrong-selected' ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-900 dark:text-foreground')}>
                      {key}.
                    </span>
                    <span className={cn('text-sm leading-relaxed mt-0.5',
                      state === 'correct' ? 'font-medium text-slate-900 dark:text-foreground'
                        : 'text-slate-600 dark:text-muted-foreground')}>
                      {text}
                    </span>
                  </div>
                ))}
              </div>

              {/* Explanation card — always expanded */}
              <div className="mx-4 mb-4 border border-l-4 border-l-red-500 border-red-200 dark:border-red-900 bg-white dark:bg-card rounded-lg shadow-sm">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <X className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">{t('help.answerIncorrect')}</span>
                  <span className="text-xs text-slate-500 ml-1">
                    {t('help.correctAnswerLabel')} <span className="font-bold text-slate-900 dark:text-foreground">B</span>
                  </span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs font-semibold text-slate-700 dark:text-foreground mb-1.5">{t('help.explanationTitle')}</p>
                  <p className="text-xs text-slate-600 dark:text-muted-foreground leading-relaxed">
                    {t('help.explanationBeforeRule')} <strong>FRCP Rule 56(b)</strong>, {t('help.explanationAfterRule')}
                    <strong>{t('help.discoveryClose30Days')}</strong>{t('help.explanationEnding')}
                  </p>
                  <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{t('help.topicTags')}</span>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">Civil Procedure</span>
                    <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded font-medium">Rule 56(b)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const FAQ_ITEMS: { qKey: string; aKey: string; cat: Exclude<FaqCategory, 'all'> }[] = [
  { cat: 'tech', qKey: 'help.faq.login.q', aKey: 'help.faq.login.a' },
  { cat: 'tech', qKey: 'help.faq.mobile.q', aKey: 'help.faq.mobile.a' },
  { cat: 'tech', qKey: 'help.faq.troubleshoot.q', aKey: 'help.faq.troubleshoot.a' },
  { cat: 'tech', qKey: 'help.faq.multiDevice.q', aKey: 'help.faq.multiDevice.a' },
  { cat: 'feature', qKey: 'help.faq.closePage.q', aKey: 'help.faq.closePage.a' },
  { cat: 'feature', qKey: 'help.faq.wrongBook.q', aKey: 'help.faq.wrongBook.a' },
  { cat: 'feature', qKey: 'help.faq.unused.q', aKey: 'help.faq.unused.a' },
  { cat: 'feature', qKey: 'help.faq.clearData.q', aKey: 'help.faq.clearData.a' },
  { cat: 'exam', qKey: 'help.faq.source.q', aKey: 'help.faq.source.a' },
  { cat: 'exam', qKey: 'help.faq.pacing.q', aKey: 'help.faq.pacing.a' },
  { cat: 'exam', qKey: 'help.faq.ai.q', aKey: 'help.faq.ai.a' },
];

const FAQ_PILLS: { key: FaqCategory; labelKey: string }[] = [
  { key: 'all', labelKey: 'help.faq.all' },
  { key: 'tech', labelKey: 'help.faq.tech' },
  { key: 'feature', labelKey: 'help.faq.feature' },
  { key: 'exam', labelKey: 'help.faq.exam' },
];

function FaqSection() {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<FaqCategory>('all');
  const [search, setSearch] = useState('');
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());

  const toggleOpen = (i: number) =>
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  const filtered = FAQ_ITEMS.filter((item) => {
    const matchesCat = activeCategory === 'all' || item.cat === activeCategory;
    const q = search.toLowerCase();
    const question = t(item.qKey).toLowerCase();
    const answer = t(item.aKey).toLowerCase();
    const matchesSearch = !q || question.includes(q) || answer.includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('help.faqTitle')}</h2>
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('help.searchFaqPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpenIndices(new Set()); }}
            className="pl-8 text-xs h-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FAQ_PILLS.map(({ key, labelKey }) => (
          <button key={key} onClick={() => { setActiveCategory(key); setOpenIndices(new Set()); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-150',
              activeCategory === key
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30',
            )}>
            {t(labelKey)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 bg-card border border-border rounded-2xl">
          <p className="text-sm text-muted-foreground">{t('help.noFaqResults')}</p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden divide-y divide-border">
          {filtered.map((item, i) => (
            <div key={i} className="px-5 cursor-pointer" onClick={() => toggleOpen(i)}>
              <div className="flex justify-between items-center py-4 select-none gap-3">
                <span className={cn('text-sm font-medium transition-colors flex items-center gap-2',
                  openIndices.has(i) ? 'text-primary' : 'text-foreground hover:text-primary')}>
                  <span className="text-primary font-bold shrink-0">Q.</span>
                  {t(item.qKey)}
                </span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200', openIndices.has(i) && 'rotate-180')} />
              </div>
              {openIndices.has(i) && (
                <div className="text-sm text-muted-foreground leading-relaxed pb-4 pl-6 border-l-2 border-primary/30 whitespace-pre-line">
                  {t(item.aKey)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Feedback Form ────────────────────────────────────────────────────────────

function FeedbackForm() {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();

  const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
    { value: 'content', label: t('help.feedbackCategoryContent') },
    { value: 'bug',     label: t('help.feedbackCategoryBug') },
    { value: 'feature', label: t('help.feedbackCategoryFeature') },
  ];

  const [category, setCategory] = useState<FeedbackCategory>('content');
  const [subject, setSubject] = useState('');
  // Content-specific optional reference fields
  const [refSubject, setRefSubject] = useState('');
  const [refChapter, setRefChapter] = useState('');
  const [refQid, setRefQid] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  useEffect(() => {
    setEmail(profile?.email ?? user?.email ?? '');
  }, [profile, user]);

  useEffect(() => {
    getSubjects().then(setSubjects).catch(() => {});
  }, []);

  const availableChapters = subjects.find((s) => s.name === refSubject)?.chapters ?? [];

  const resetRefFields = () => { setRefSubject(''); setRefChapter(''); setRefQid(''); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !subject.trim()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase!.from('feedback').insert({
        user_id: user?.id ?? null,
        category,
        subject,
        qid: refQid || null,
        ref_subject: refSubject || null,
        ref_chapter: refChapter || null,
        email,
        message,
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
      const label = FEEDBACK_CATEGORIES.find((c) => c.value === category)?.label ?? category;
      toast({ title: t('help.feedbackSuccessToast', { subject, label }) });
      setSubject('');
      resetRefFields();
      setMessage('');
    } catch {
      toast({ title: t('help.feedbackErrorToast'), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{t('help.feedbackTitle')}</h2>
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Row 1: Category + Email */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                {t('help.feedbackCategory')} <span className="text-destructive">*</span>
              </Label>
              <Select value={category} onValueChange={(v) => { setCategory(v as FeedbackCategory); resetRefFields(); }}>
                <SelectTrigger className="text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_CATEGORIES.map(({ value, label }) => (
                    <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                {t('help.contactEmail')} <span className="text-destructive">*</span>
              </Label>
              <Input type="email" value={email} readOnly className="text-sm h-9 bg-muted/60 text-muted-foreground cursor-not-allowed" />
            </div>

            {/* Row 2: Topic (always full width or half depending on category) */}
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-semibold">
                {t('help.feedbackSubject')} <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder={t('help.feedbackSubjectPlaceholder')}
                value={subject} onChange={(e) => setSubject(e.target.value)} required className="text-sm h-9" />
            </div>

            {/* Row 3: Content-specific reference fields — all optional */}
            {category === 'content' && (
              <>
                {/* Subject dropdown */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    {t('help.refSubjectOptional')}
                  </Label>
                  <Select
                    value={refSubject}
                    onValueChange={(v) => { setRefSubject(v === '__none__' ? '' : v); setRefChapter(''); }}
                  >
                    <SelectTrigger className="text-sm h-9">
                      <SelectValue placeholder={t('help.selectSubjectPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-sm text-muted-foreground">
                        {t('help.noneOption')}
                      </SelectItem>
                      {subjects.map((s) => (
                        <SelectItem key={s.id} value={s.name} className="text-sm">{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Chapter dropdown — depends on selected subject */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    {t('help.refChapterOptional')}
                  </Label>
                  <Select
                    value={refChapter}
                    onValueChange={(v) => setRefChapter(v === '__none__' ? '' : v)}
                    disabled={availableChapters.length === 0}
                  >
                    <SelectTrigger className="text-sm h-9">
                      <SelectValue placeholder={
                        availableChapters.length === 0
                          ? t('help.selectSubjectFirst')
                          : t('help.selectChapterPlaceholder')
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-sm text-muted-foreground">
                        {t('help.noneOption')}
                      </SelectItem>
                      {availableChapters.map((c) => (
                        <SelectItem key={c.id} value={c.name} className="text-sm">{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* QID text input */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    {t('help.qidOptional')}
                  </Label>
                  <Input
                    type="number" placeholder="1024"
                    value={refQid} onChange={(e) => setRefQid(e.target.value)}
                    className="text-sm h-9" />
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              {t('help.description')} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder={t('help.descriptionPlaceholder')}
              value={message} onChange={(e) => setMessage(e.target.value)} rows={4} required className="text-sm" />
          </div>

          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={submitting} className="gap-1.5 text-sm px-5">
              <Send className="w-3.5 h-3.5" />
              {submitting ? t('help.submitting') : t('help.submitFeedback')}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-10">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-primary">{t('help.title')}</h1>
      </div>

      {/* Quick start — full width, timer embedded in step 2 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('help.quickStartTitle')}</h2>
        <InteractiveStepGuide />
      </section>

      <FaqSection />
      <FeedbackForm />
    </div>
  );
}
