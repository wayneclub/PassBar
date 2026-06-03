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

const FAQ_ITEMS: { q: string; a: string; cat: Exclude<FaqCategory, 'all'> }[] = [
  {
    cat: 'tech',
    q: '為什麼我無法登入？',
    a: 'PassBar 使用 Google 帳號登入。請確認您點擊的是「使用 Google 登入」按鈕，並在彈出視窗中選取正確的 Google 帳號。若彈出視窗被瀏覽器封鎖，請允許彈出視窗後再試。若帳號已申請但顯示「待審核」，請等候管理員核准通知。',
  },
  {
    cat: 'tech',
    q: '支援在 iPad 或手機瀏覽器上刷題嗎？',
    a: '支援！PassBar 採用完整 RWD 響應式設計，iOS Safari、iPadOS Chrome、Android 瀏覽器均可正常使用，觸控手感亦有針對行動裝置優化。',
  },
  {
    cat: 'tech',
    q: '如果遇到系統頁面卡死或按鈕沒反應，該如何排除？',
    a: '請嘗試：\n1. Ctrl+F5（Windows）或 Cmd+Shift+R（Mac）強制重整。\n2. 清除瀏覽器 Cookie 與快取後重新開啟。\n3. 若仍有問題，請透過下方系統建議表單回報。',
  },
  {
    cat: 'tech',
    q: '可以多台裝置同時登入同一個帳號嗎？',
    a: '可以，但建議不要同時在多台裝置上寫同一份考卷，否則可能因兩端同時寫入而導致答題歷程不同步。建議同一時間僅在單一裝置上完成練習。',
  },
  {
    cat: 'feature',
    q: '寫題寫到一半關閉頁面，答題記錄會消失嗎？',
    a: '不會！每次點選選項，系統都會即時同步至雲端。即使意外關閉頁面，下次進入「歷史練習」仍可找到未完成的考卷並繼續作答。',
  },
  {
    cat: 'feature',
    q: '什麼是「錯題本自動歸檔」？',
    a: '每當您答錯一題，系統會自動將其標記並歸檔於「學習表現」的錯題本中。您可按科目篩選錯題、重新抽考，直到答對才降級。詳讀附帶的考點大綱是備考中後期提高正確率的關鍵方法。',
  },
  {
    cat: 'feature',
    q: '可以只篩選「還沒寫過」的新題目嗎？',
    a: '可以！在「建立測驗」中選擇 Unused 篩選條件，系統會排除所有做過的題目，只抽出全新題目組成考卷，適合考前做盲測評估真實實力。',
  },
  {
    cat: 'feature',
    q: '歷史練習與學習表現可以清空重來嗎？',
    a: '可以。前往「設定」頁面最下方找到「重設所有練習數據」。請注意此操作不可還原，所有歷程與錯題歸檔將完全抹除，建議完成一整輪刷題後再考慮使用。',
  },
  {
    cat: 'exam',
    q: '題目來源是什麼？是否符合最新 MBE 考試大綱？',
    a: '所有題目依據 NCBE（National Conference of Bar Examiners）最新發布的考試大綱設計，涵蓋全部七大科目，並針對近年越考越靈活的長難題型重點收錄。All questions are reviewed to align with recent exam trends.',
  },
  {
    cat: 'exam',
    q: 'MBE 考試一題只有 108 秒，該如何平時訓練？',
    a: '建議分兩階段：\n1. 前中期（打底）：不限時，專注讀懂 Fact Pattern 並找出隱藏考點。\n2. 中後期（衝刺）：開啟計時模式，每題強迫自己在 1.8 分鐘內決定，訓練刪除誘餌選項的直覺。',
  },
  {
    cat: 'exam',
    q: 'AI 學習表現分析是什麼？如何有效針對弱點補強？',
    a: '在「學習表現」頁面，系統會根據您的答題歷程自動產生 AI 診斷報告，分析各科目的正確率趨勢、高頻出錯考點，並給出具體的補強建議。\n\n有效利用方式：\n1. 優先處理正確率低於 50% 的科目，點擊「生成 AI 診斷」獲得針對性分析。\n2. 搭配錯題本，對 AI 指出的弱點考點重新抽考直到穩定答對。\n3. 每完成一輪 50 題後重新查看報告，追蹤進步曲線。',
  },
];

const FAQ_PILLS: { key: FaqCategory; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'tech', label: '帳號與技術' },
  { key: 'feature', label: '題庫功能' },
  { key: 'exam', label: '題目與考點' },
];

function FaqSection() {
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
    const matchesSearch = !q || item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">常見問答</h2>
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="搜尋問題..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpenIndices(new Set()); }}
            className="pl-8 text-xs h-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FAQ_PILLS.map(({ key, label }) => (
          <button key={key} onClick={() => { setActiveCategory(key); setOpenIndices(new Set()); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-150',
              activeCategory === key
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30',
            )}>
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 bg-card border border-border rounded-2xl">
          <p className="text-sm text-muted-foreground">找不到相關問答，試試其他關鍵字。</p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden divide-y divide-border">
          {filtered.map((item, i) => (
            <div key={i} className="px-5 cursor-pointer" onClick={() => toggleOpen(i)}>
              <div className="flex justify-between items-center py-4 select-none gap-3">
                <span className={cn('text-sm font-medium transition-colors flex items-center gap-2',
                  openIndices.has(i) ? 'text-primary' : 'text-foreground hover:text-primary')}>
                  <span className="text-primary font-bold shrink-0">Q.</span>
                  {item.q}
                </span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200', openIndices.has(i) && 'rotate-180')} />
              </div>
              {openIndices.has(i) && (
                <div className="text-sm text-muted-foreground leading-relaxed pb-4 pl-6 border-l-2 border-primary/30 whitespace-pre-line">
                  {item.a}
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
  const { language } = useI18n();
  const { toast } = useToast();

  const isZh = language === 'zh-Hans' || language === 'zh-Hant';

  const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
    { value: 'content', label: isZh ? '題目勘誤與錯字' : 'Content Correction' },
    { value: 'bug',     label: isZh ? '程式 Bug 反饋'   : 'Technical Issue' },
    { value: 'feature', label: isZh ? '功能改良建議'     : 'Feature Request' },
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
      toast({ title: `「${subject}」已送出，感謝您的回報！（${label}）` });
      setSubject('');
      resetRefFields();
      setMessage('');
    } catch {
      toast({ title: '送出失敗，請稍後再試。', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">系統建議</h2>
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Row 1: Category + Email */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                {isZh ? '回報類別' : 'Category'} <span className="text-destructive">*</span>
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
                {isZh ? '聯絡 Email' : 'Contact Email'} <span className="text-destructive">*</span>
              </Label>
              <Input type="email" value={email} readOnly className="text-sm h-9 bg-muted/60 text-muted-foreground cursor-not-allowed" />
            </div>

            {/* Row 2: Topic (always full width or half depending on category) */}
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-semibold">
                {isZh ? '主題' : 'Subject'} <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder={isZh ? '簡述您的回報或建議' : 'Brief summary of your report'}
                value={subject} onChange={(e) => setSubject(e.target.value)} required className="text-sm h-9" />
            </div>

            {/* Row 3: Content-specific reference fields — all optional */}
            {category === 'content' && (
              <>
                {/* Subject dropdown */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    {isZh ? '科目（選填）' : 'Subject (optional)'}
                  </Label>
                  <Select
                    value={refSubject}
                    onValueChange={(v) => { setRefSubject(v === '__none__' ? '' : v); setRefChapter(''); }}
                  >
                    <SelectTrigger className="text-sm h-9">
                      <SelectValue placeholder={isZh ? '選擇科目…' : 'Select subject…'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-sm text-muted-foreground">
                        {isZh ? '— 不指定 —' : '— None —'}
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
                    {isZh ? '章節（選填）' : 'Chapter (optional)'}
                  </Label>
                  <Select
                    value={refChapter}
                    onValueChange={(v) => setRefChapter(v === '__none__' ? '' : v)}
                    disabled={availableChapters.length === 0}
                  >
                    <SelectTrigger className="text-sm h-9">
                      <SelectValue placeholder={
                        availableChapters.length === 0
                          ? (isZh ? '請先選擇科目' : 'Select subject first')
                          : (isZh ? '選擇章節…' : 'Select chapter…')
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-sm text-muted-foreground">
                        {isZh ? '— 不指定 —' : '— None —'}
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
                    {isZh ? '題號 QID（選填）' : 'Question ID (optional)'}
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
              {isZh ? '詳細說明' : 'Description'} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder={isZh ? '請具體描述您發現的問題或建議...' : 'Describe the issue or suggestion in detail...'}
              value={message} onChange={(e) => setMessage(e.target.value)} rows={4} required className="text-sm" />
          </div>

          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={submitting} className="gap-1.5 text-sm px-5">
              <Send className="w-3.5 h-3.5" />
              {submitting ? (isZh ? '送出中...' : 'Submitting...') : (isZh ? '送出建議' : 'Submit')}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HelpPage() {
  return (
    <div className="space-y-10">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-primary">幫助與備考指引中心</h1>
      </div>

      {/* Quick start — full width, timer embedded in step 2 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">快速上手指引</h2>
        <InteractiveStepGuide />
      </section>

      <FaqSection />
      <FeedbackForm />
    </div>
  );
}
