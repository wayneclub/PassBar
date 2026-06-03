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
} from 'lucide-react';
import type { DisplayOptions, TextSize } from '@/lib/study-settings';

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
  onFeedback: () => void;
  isBrowse?: boolean;
  /** Current question subject name */
  subject?: string;
  /** Current question chapter/topic name */
  topic?: string;
  /** Countdown limit in seconds (SimExam mode) */
  timeLimitSeconds?: number;
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
  onFeedback,
  isBrowse = false,
  subject,
  topic,
  timeLimitSeconds,
  onTimeUp,
  shortcutHelpOpen,
  onShortcutHelpOpenChange,
}: TestHeaderProps) {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  return (
    <header className="h-14 bg-secondary text-white flex items-center justify-between px-4 fixed top-0 w-full z-50">
      {/* Left: icons + subject */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={currentMarked}
          aria-label={currentMarked ? t('test.unmarkQuestion') : t('test.markQuestion')}
          className={cn(
            'hover:bg-white/10 hover:text-white',
            currentMarked ? 'bg-primary/15 text-primary' : 'text-primary',
          )}
          onClick={onToggleMark}
        >
          <Bookmark className={cn('w-5 h-5', currentMarked && 'fill-current')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onFeedback}
          aria-label={t('test.feedback')}
          className="text-primary hover:bg-white/10 hover:text-white"
        >
          <Flag className="w-5 h-5" />
        </Button>
      </div>

      <Popover open={questionMenuOpen} onOpenChange={setQuestionMenuOpen}>
        <PopoverTrigger asChild>
          <button className="flex flex-col items-center gap-0.5 rounded px-4 py-1.5 text-white transition-colors hover:bg-white/10">
            <span className="flex items-center gap-1.5">
              <span className="text-lg font-semibold tabular-nums">{questionIndex + 1}/{totalQuestions}</span>
              <ChevronDown className={cn('h-4 w-4 text-primary transition-transform', questionMenuOpen && 'rotate-180')} />
            </span>
            {/* Subject · Chapter together — desktop only */}
            {(subject || topic) && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 max-w-[320px]">
                {subject && (
                  <span className="truncate max-w-[140px] font-medium text-slate-300">{subject}</span>
                )}
                {subject && topic && <span className="text-slate-600">·</span>}
                {topic && (
                  <span className="truncate max-w-[160px] font-medium text-primary/80">{topic}</span>
                )}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] border-slate-200 bg-white p-4 text-slate-900" sideOffset={10}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">{t('test.questions')}</div>
            <div className="text-xs text-slate-500">
              {t(isBrowse ? 'test.viewedCount' : 'test.answeredCount', { answered: answeredIndexes.size, total: totalQuestions })}
            </div>
          </div>
          <div className="grid max-h-[340px] grid-cols-6 gap-2 overflow-y-auto pr-1">
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
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Popover open={isShortcutHelpOpen} onOpenChange={setShortcutHelpOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('test.keyboardShortcuts')}
                className={cn(
                  'h-9 w-9 text-primary hover:bg-white/10 hover:text-white',
                  isShortcutHelpOpen && 'bg-primary/15 text-white',
                )}
              >
                <HelpCircle className="w-5 h-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 border-slate-200 bg-white p-4 text-slate-900" sideOffset={10}>
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
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('nav.settings')}
                className={cn(
                  'h-9 w-9 text-primary hover:bg-white/10 hover:text-white',
                  settingsOpen && 'bg-primary/15 text-white',
                )}
              >
                <Settings className="w-5 h-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 border-slate-200 bg-white p-4 text-slate-900" sideOffset={10}>
              {/* Font Size */}
              <div className="mb-4">
                <div className="mb-2 text-sm font-semibold text-slate-800">{t('settings.textSize')}</div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-600 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30"
                    disabled={textSize === 'medium'}
                    onClick={() => onTextSizeChange('medium')}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="font-semibold text-slate-800">
                    {textSize === 'medium' ? t('settings.medium') : t('settings.large')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-600 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30"
                    disabled={textSize === 'large'}
                    onClick={() => onTextSizeChange('large')}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mb-1 border-t border-slate-100 pt-4">
                <div className="mb-3 text-sm font-semibold text-slate-800">{t('settings.displayQA')}</div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">{t('settings.english')}</span>
                    <Switch
                      checked={display.enQA}
                      onCheckedChange={(checked) => onDisplayChange({ ...display, enQA: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">{t('settings.chinese')}</span>
                    <Switch
                      checked={display.zhQA}
                      onCheckedChange={(checked) => onDisplayChange({ ...display, zhQA: checked })}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-3 text-sm font-semibold text-slate-800">{t('settings.displayExplanation')}</div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">{t('settings.english')}</span>
                    <Switch
                      checked={display.enExplanation}
                      onCheckedChange={(checked) => onDisplayChange({ ...display, enExplanation: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">{t('settings.chinese')}</span>
                    <Switch
                      checked={display.zhExplanation}
                      onCheckedChange={(checked) => onDisplayChange({ ...display, zhExplanation: checked })}
                    />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        
        <div className={cn(
          "text-lg font-mono tracking-wider tabular-nums",
          isUrgent && "text-red-400 animate-pulse"
        )}>
          {isCountdown && <span className="mr-1 text-xs font-sans opacity-70">{t('test.timeRemaining')}</span>}
          {formatTime(displaySeconds)}
        </div>
      </div>
    </header>
  );
}
