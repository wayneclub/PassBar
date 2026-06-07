"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  Settings,
  HelpCircle,
  Bookmark,
  ChevronDown,
  Flag,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { defaultStudySettings, type DisplayOptions, type TextSize } from '@/lib/study-settings';

interface TestHeaderProps {
  questionIndex: number;
  totalQuestions: number;
  answeredQuestionIndexes: number[];
  markedQuestionIndexes: number[];
  timeSpent: number;
  onTimeUpdate: (time: number) => void;
  onQuestionSelect: (index: number) => void;
  onToggleMark: () => void;
  isPaused: boolean;
  textSize: TextSize;
  onTextSizeChange: (size: TextSize) => void;
  display: DisplayOptions;
  onDisplayChange: (display: DisplayOptions) => void;
  showNotes: boolean;
  onShowNotesChange: (show: boolean) => void;
  onFeedback: () => void;
  onReset: () => void;
  isBrowse?: boolean;
  /** Current question subject name */
  subject?: string;
  /** Current question chapter/topic name */
  topic?: string;
  /** Countdown limit in seconds (SimExam mode) */
  timeLimitSeconds?: number;
  /** Per-question countdown seconds remaining (108s practice aid) */
  perQuestionTimeLeft?: number | null;
  /** Called when countdown reaches zero */
  onTimeUp?: () => void;
  shortcutHelpOpen?: boolean;
  onShortcutHelpOpenChange?: (open: boolean) => void;
}

export function TestHeader({
  questionIndex,
  totalQuestions,
  answeredQuestionIndexes,
  markedQuestionIndexes,
  timeSpent,
  onTimeUpdate,
  onQuestionSelect,
  onToggleMark,
  isPaused,
  textSize,
  onTextSizeChange,
  display,
  onDisplayChange,
  showNotes,
  onShowNotesChange,
  onFeedback,
  onReset,
  isBrowse = false,
  subject,
  topic,
  timeLimitSeconds,
  perQuestionTimeLeft,
  onTimeUp,
  shortcutHelpOpen,
  onShortcutHelpOpenChange,
}: TestHeaderProps) {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);

  function safeDisplayChange(next: DisplayOptions) {
    const qaOk = next.enQA || next.zhQA;
    const expOk = next.enExplanation || next.zhExplanation;
    if (!qaOk || !expOk) return;
    onDisplayChange(next);
  }
  const isCountdown = timeLimitSeconds !== undefined;
  const [localTime, setLocalTime] = useState(timeSpent);
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const [localShortcutHelpOpen, setLocalShortcutHelpOpen] = useState(false);
  const nextTimeRef = useRef(timeSpent);
  const timeUpFiredRef = useRef(false);
  const answeredIndexes = new Set(answeredQuestionIndexes);
  const markedIndexes = new Set(markedQuestionIndexes);
  const currentMarked = markedIndexes.has(questionIndex);
  const isShortcutHelpOpen = shortcutHelpOpen ?? localShortcutHelpOpen;
  const setShortcutHelpOpen = onShortcutHelpOpenChange ?? setLocalShortcutHelpOpen;
  const shortcutRows = [
    { keys: 'A / B / C / D', action: t('test.shortcutAnswerChoices') },
    { keys: '1 / 2 / 3 / 4', action: t('test.shortcutNumberChoices') },
    { keys: 'Enter', action: t('test.shortcutSubmit') },
    { keys: '← / →', action: t('test.shortcutNavigate') },
    { keys: 'M', action: t('test.shortcutMark') },
    { keys: 'P', action: t('test.shortcutPause') },
    { keys: '?', action: t('test.shortcutHelp') },
  ];

  useEffect(() => {
    setLocalTime(timeSpent);
    nextTimeRef.current = timeSpent;
  }, [timeSpent]);

  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      nextTimeRef.current += 1;
      const next = nextTimeRef.current;
      setLocalTime(next);
      onTimeUpdate(next);
      if (isCountdown && timeLimitSeconds !== undefined && next >= timeLimitSeconds && !timeUpFiredRef.current) {
        timeUpFiredRef.current = true;
        onTimeUp?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPaused, onTimeUpdate, isCountdown, timeLimitSeconds, onTimeUp]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs > 0 ? `${hrs}:` : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const displaySeconds = isCountdown && timeLimitSeconds !== undefined
    ? Math.max(0, timeLimitSeconds - localTime)
    : localTime;
  const isUrgent = isCountdown && timeLimitSeconds !== undefined && (timeLimitSeconds - localTime) < 600;

  // Per-question timer display states
  const hasPerQ = perQuestionTimeLeft !== null && perQuestionTimeLeft !== undefined;
  const perQUrgent = hasPerQ && (perQuestionTimeLeft as number) <= 10;
  const perQWarning = hasPerQ && !perQUrgent && (perQuestionTimeLeft as number) <= 30;

  return (
    <header className="h-12 sm:h-14 bg-secondary text-white grid grid-cols-[auto_1fr_auto] items-center px-3 sm:px-4 fixed top-0 w-full z-50">
      {/* Left: icons */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={currentMarked}
          aria-label={currentMarked ? t('test.unmarkQuestion') : t('test.markQuestion')}
          className={cn(
            'h-8 w-8 sm:h-9 sm:w-9 hover:bg-white/10 hover:text-white',
            currentMarked ? 'bg-primary/15 text-primary' : 'text-primary',
          )}
          onClick={onToggleMark}
        >
          <Bookmark className={cn('w-4 h-4 sm:w-5 sm:h-5', currentMarked && 'fill-current')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onFeedback}
          aria-label={t('test.feedback')}
          className="h-8 w-8 sm:h-9 sm:w-9 text-primary hover:bg-white/10 hover:text-white"
        >
          <Flag className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>
      </div>

      <Popover open={questionMenuOpen} onOpenChange={setQuestionMenuOpen}>
        <PopoverTrigger asChild>
          <button className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded px-2 sm:px-4 py-1.5 text-white transition-colors hover:bg-white/10">
            <span className="flex items-center gap-1">
              <span className="text-base sm:text-lg font-semibold tabular-nums">{questionIndex + 1}/{totalQuestions}</span>
              <ChevronDown className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary transition-transform', questionMenuOpen && 'rotate-180')} />
            </span>
            {/* Subject · Chapter — removed from top bar, now shown as pills below question number */}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(360px,calc(100vw-1rem))] border-slate-200 bg-white p-4 text-slate-900" sideOffset={10} align="center" avoidCollisions collisionPadding={8}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">{t('test.questions')}</div>
            <div className="text-xs text-slate-500">
              {t(isBrowse ? 'test.viewedCount' : 'test.answeredCount', { answered: answeredIndexes.size, total: totalQuestions })}
            </div>
          </div>
          <div className="grid max-h-[340px] grid-cols-5 sm:grid-cols-6 gap-1.5 sm:gap-2 overflow-y-auto pr-1">
            {Array.from({ length: totalQuestions }, (_, index) => {
              const isCurrent = index === questionIndex;
              const isAnswered = answeredIndexes.has(index);
              const isMarked = markedIndexes.has(index);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    onQuestionSelect(index);
                    setQuestionMenuOpen(false);
                  }}
                  className={cn(
                    'flex h-10 items-center justify-center rounded-md border text-sm font-semibold transition-colors',
                    isCurrent && 'border-secondary bg-secondary text-white',
                    !isCurrent && isAnswered && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
                    !isCurrent && !isAnswered && 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span className="relative">
                    {index + 1}
                    {isMarked ? <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-amber-400" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-secondary" /> {t('test.current')}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> {t(isBrowse ? 'test.viewed' : 'test.answered')}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> {t('test.marked')}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-slate-300" /> {t(isBrowse ? 'test.unviewed' : 'test.unanswered')}</span>
          </div>
        </PopoverContent>
      </Popover>

      {/* Right Icons */}
      <div className="flex items-center justify-end gap-2 sm:gap-4">
        <div className="flex items-center gap-0.5 sm:gap-1">
          {/* Help — hidden on mobile (keyboard shortcuts not relevant on touch) */}
          <Popover open={isShortcutHelpOpen} onOpenChange={setShortcutHelpOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('test.keyboardShortcuts')}
                className={cn(
                  'hidden sm:flex h-9 w-9 text-primary hover:bg-white/10 hover:text-white',
                  isShortcutHelpOpen && 'bg-primary/15 text-white',
                )}
              >
                <HelpCircle className="w-5 h-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(320px,calc(100vw-1rem))] border-slate-200 bg-white p-4 text-slate-900" sideOffset={10} avoidCollisions collisionPadding={8}>
              <div className="mb-3">
                <div className="text-sm font-semibold text-slate-900">{t('test.keyboardShortcuts')}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{t('test.keyboardShortcutsDescription')}</div>
              </div>
              <div className="space-y-2">
                {shortcutRows.map((row) => (
                  <div key={row.keys} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                    <kbd className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs font-semibold text-slate-700 shadow-sm">
                      {row.keys}
                    </kbd>
                    <span className="text-right text-xs font-medium leading-5 text-slate-600">{row.action}</span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('nav.settings')}
            onClick={() => setSettingsOpen(true)}
            className={cn(
              'h-8 w-8 sm:h-9 sm:w-9 text-primary hover:bg-white/10 hover:text-white',
              settingsOpen && 'bg-white/10 text-white',
            )}
          >
            <Settings className="w-5 h-5" />
          </Button>

          {/* Settings Drawer */}
          {/* Overlay */}
          <div
            className={cn(
              "fixed inset-0 z-30 transition-opacity duration-300",
              settingsOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
            onClick={() => setSettingsOpen(false)}
          />

          {/* Drawer Box */}
          <div
            className={cn(
              "fixed right-0 z-40 bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col text-slate-900 transform",
              "top-12 sm:top-14 bottom-14 sm:bottom-20",
              "w-full md:w-80",
              "border-l border-slate-200",
              settingsOpen ? "translate-x-0" : "translate-x-full"
            )}
          >
            {/* Header */}
            <div className="bg-secondary border-b border-white/10 px-6 py-2.5 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-100">{t('nav.settings')}</p>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              >
                <span className="text-sm font-semibold">✕</span>
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5 flex-1 overflow-y-auto">
              {/* Font Size */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('settings.textSize')}</p>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30"
                    disabled={textSize === 'medium'}
                    onClick={() => onTextSizeChange('medium')}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-sm font-semibold text-slate-800">
                    {textSize === 'medium' ? t('settings.medium') : t('settings.large')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30"
                    disabled={textSize === 'large'}
                    onClick={() => onTextSizeChange('large')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Study Notes Toggle */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('settings.studyModeTitle')}</p>
                <div className="rounded-lg border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                  <div className="flex items-center justify-between bg-white px-3.5 py-3 hover:bg-slate-50 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{t('settings.studyNotes')}</span>
                    <Switch
                      checked={showNotes}
                      onCheckedChange={onShowNotesChange}
                    />
                  </div>
                </div>
              </div>

              {/* English toggles */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('settings.english')}</p>
                <div className="rounded-lg border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                  <div className="flex items-center justify-between bg-white px-3.5 py-3 hover:bg-slate-50 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{t('settings.displayQA')}</span>
                    <Switch
                      checked={display.enQA}
                      disabled={display.enQA && !display.zhQA}
                      onCheckedChange={(checked) => safeDisplayChange({ ...display, enQA: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between bg-white px-3.5 py-3 hover:bg-slate-50 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{t('settings.displayExplanation')}</span>
                    <Switch
                      checked={display.enExplanation}
                      disabled={display.enExplanation && !display.zhExplanation}
                      onCheckedChange={(checked) => safeDisplayChange({ ...display, enExplanation: checked })}
                    />
                  </div>
                </div>
              </div>

              {/* Chinese toggles */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('settings.chinese')}</p>
                <div className="rounded-lg border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                  <div className="flex items-center justify-between bg-white px-3.5 py-3 hover:bg-slate-50 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{t('settings.displayQA')}</span>
                    <Switch
                      checked={display.zhQA}
                      disabled={display.zhQA && !display.enQA}
                      onCheckedChange={(checked) => safeDisplayChange({ ...display, zhQA: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between bg-white px-3.5 py-3 hover:bg-slate-50 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{t('settings.displayExplanation')}</span>
                    <Switch
                      checked={display.zhExplanation}
                      disabled={display.zhExplanation && !display.enExplanation}
                      onCheckedChange={(checked) => safeDisplayChange({ ...display, zhExplanation: checked })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Reset footer */}
            <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  onTextSizeChange(defaultStudySettings.textSize);
                  onDisplayChange(defaultStudySettings.display);
                  onShowNotesChange(defaultStudySettings.showNotes);
                  onReset();
                  setSettingsOpen(false);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors border border-dashed border-slate-200 hover:border-slate-300"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('settings.restoreDefaults')}
              </button>
            </div>
          </div>
        </div>
        
        {/* Timer: per-question countdown OR normal elapsed/total countdown */}
        {hasPerQ ? (
          <div className={cn(
            "rounded-full px-3 py-1 font-mono tabular-nums text-sm sm:text-base font-semibold transition-colors duration-300",
            perQUrgent
              ? "bg-red-500/20 text-red-300 animate-pulse"
              : perQWarning
                ? "bg-amber-500/20 text-amber-300"
                : "bg-white/10 text-white"
          )}>
            {formatTime(perQuestionTimeLeft as number)}
          </div>
        ) : (
          <div className={cn(
            "text-sm sm:text-lg font-mono tracking-wider tabular-nums",
            isUrgent && "text-red-400 animate-pulse"
          )}>
            {formatTime(displaySeconds)}
          </div>
        )}
      </div>
    </header>
  );
}
