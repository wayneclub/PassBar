"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  Settings,
  Layout,
  HelpCircle,
  Bookmark,
  Zap,
  FileText,
  SquarePen,
  ChevronDown,
  Languages,
} from 'lucide-react';
import type { ContentMode } from '@/lib/study-settings';

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
  contentMode: ContentMode;
  onToggleContentMode: () => void;
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
  contentMode,
  onToggleContentMode,
}: TestHeaderProps) {
  const { t } = useI18n();
  const [localTime, setLocalTime] = useState(timeSpent);
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const nextTimeRef = useRef(timeSpent);
  const answeredIndexes = new Set(answeredQuestionIndexes);
  const markedIndexes = new Set(markedQuestionIndexes);
  const currentMarked = markedIndexes.has(questionIndex);

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
    }, 1000);

    return () => clearInterval(interval);
  }, [isPaused, onTimeUpdate]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs > 0 ? `${hrs}:` : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <header className="h-14 bg-secondary text-white flex items-center justify-between px-4 fixed top-0 w-full z-50">
      {/* Left Icons */}
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
        <Button variant="ghost" size="icon" className="text-primary hover:bg-white/10 hover:text-white">
          <Zap className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="text-primary hover:bg-white/10 hover:text-white">
          <FileText className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="text-primary hover:bg-white/10 hover:text-white">
          <SquarePen className="w-5 h-5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleContentMode}
          aria-label={contentMode === 'bilingual' ? 'Switch to English' : 'Switch to bilingual'}
          className={cn(
            'relative h-9 w-9 hover:bg-white/10 hover:text-white transition-colors',
            contentMode === 'bilingual'
              ? 'bg-primary/20 text-white'
              : 'text-primary',
          )}
        >
          <Languages className="w-5 h-5" />
          <span className={cn(
            'absolute bottom-0.5 right-0.5 text-[9px] font-bold leading-none',
            contentMode === 'bilingual' ? 'text-white' : 'text-primary',
          )}>
            {contentMode === 'bilingual' ? '中' : 'EN'}
          </span>
        </Button>
      </div>

      <Popover open={questionMenuOpen} onOpenChange={setQuestionMenuOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2 rounded px-4 py-2 text-white transition-colors hover:bg-white/10">
            <span className="text-lg font-semibold tabular-nums">{questionIndex + 1}/{totalQuestions}</span>
            <ChevronDown className={cn('h-5 w-5 text-primary transition-transform', questionMenuOpen && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] border-slate-200 bg-white p-4 text-slate-900" sideOffset={10}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">{t('test.questions')}</div>
            <div className="text-xs text-slate-500">
              {t('test.answeredCount', { answered: answeredIndexes.size, total: totalQuestions })}
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
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> {t('test.answered')}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> {t('test.marked')}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-slate-300" /> {t('test.unanswered')}</span>
          </div>
        </PopoverContent>
      </Popover>

      {/* Right Icons */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-primary hover:bg-white/10 hover:text-white">
            <HelpCircle className="w-5 h-5" />
          </Button>
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 text-primary hover:bg-white/10 hover:text-white">
            <Link href="/settings" aria-label={t('nav.settings')}>
              <Settings className="w-5 h-5" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 text-primary hover:bg-white/10 hover:text-white">
            <Layout className="w-5 h-5" />
          </Button>
        </div>
        
        <div className="text-lg font-mono tracking-wider tabular-nums">
          {formatTime(localTime)}
        </div>
      </div>
    </header>
  );
}
