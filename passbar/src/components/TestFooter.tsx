"use client";

import React from 'react';
import { useI18n } from '@/lib/i18n';
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Send,
  StopCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TestFooterProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSuspend: () => void;
  onEnd: () => void;
  onSubmit: () => void;
  onFeedback: () => void;
  showSubmit: boolean;
  feedbackLoading?: boolean;
  isPaused: boolean;
  isTutorMode: boolean;
}

export function TestFooter({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSuspend,
  onEnd,
  onSubmit,
  onFeedback,
  showSubmit,
  feedbackLoading = false,
  isPaused,
  isTutorMode,
}: TestFooterProps) {
  const { t } = useI18n();

  return (
    <footer className="fixed bottom-0 z-50 w-full border-t border-primary/30 bg-secondary text-white shadow-lg">

      {/* ── Desktop layout (sm+): single row ─────────────────────────── */}
      <div className="hidden sm:grid h-20 grid-cols-[1fr_auto_1fr] items-center px-6">
        {/* Left: End + Pause */}
        <div className="flex items-center gap-5">
          <button
            onClick={onEnd}
            className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            <StopCircle className="w-5 h-5 text-primary" />
            {t('test.end')}
          </button>
          <button
            onClick={onSuspend}
            className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            {isPaused ? <PlayCircle className="w-5 h-5 text-primary" /> : <PauseCircle className="w-5 h-5 text-primary" />}
            {isPaused ? t('test.resume') : t('test.suspend')}
          </button>
        </div>

        {/* Center: Submit / Feedback */}
        <div className="flex min-w-[260px] justify-center">
          {showSubmit ? (
            <button
              onClick={onSubmit}
              className="flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-md bg-primary px-8 text-base font-bold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
            >
              <Send className="h-5 w-5" />
              {t('test.submit')}
            </button>
          ) : isTutorMode ? (
            <button
              type="button"
              onClick={onFeedback}
              disabled={feedbackLoading || isPaused}
              className="flex items-center gap-2 text-sm font-medium text-slate-300 transition-colors hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              <MessageSquare className="w-5 h-5 text-primary" />
              {feedbackLoading ? t('test.generatingFeedback') : t('test.feedback')}
            </button>
          ) : null}
        </div>

        {/* Right: Prev / Next */}
        <div className="flex items-center justify-end gap-6">
          <button
            onClick={onBack}
            disabled={!canGoBack || isPaused}
            className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            {t('test.previous')}
          </button>
          <button
            onClick={onForward}
            disabled={!canGoForward || isPaused}
            className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {t('test.next')}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Mobile layout (<sm): two rows ─────────────────────────────── */}
      <div className="sm:hidden">
        {/* Row 1: Submit (full-width) or Feedback */}
        {(showSubmit || isTutorMode) && (
          <div className="border-b border-white/10 px-4 py-2">
            {showSubmit ? (
              <button
                onClick={onSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 text-base font-bold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 active:scale-[0.98]"
              >
                <Send className="h-5 w-5" />
                {t('test.submit')}
              </button>
            ) : isTutorMode ? (
              <button
                type="button"
                onClick={onFeedback}
                disabled={feedbackLoading || isPaused}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-white/20 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:text-white disabled:cursor-wait disabled:opacity-60"
              >
                <MessageSquare className="h-5 w-5 text-primary" />
                {feedbackLoading ? t('test.generatingFeedback') : t('test.feedback')}
              </button>
            ) : null}
          </div>
        )}

        {/* Row 2: Prev | End+Pause | Next */}
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-3">
          {/* Prev */}
          <button
            onClick={onBack}
            disabled={!canGoBack || isPaused}
            className={cn(
              'flex items-center justify-start gap-1.5 text-sm font-medium transition-colors',
              canGoBack && !isPaused ? 'text-slate-200 active:text-white' : 'text-slate-600 cursor-not-allowed',
            )}
          >
            <ChevronLeft className="h-5 w-5" />
            {t('test.previous')}
          </button>

          {/* End + Pause — center */}
          <div className="flex items-center gap-4 px-3">
            <button
              onClick={onEnd}
              className="flex flex-col items-center gap-0.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <StopCircle className="h-5 w-5 text-primary" />
              {t('test.end')}
            </button>
            <button
              onClick={onSuspend}
              className="flex flex-col items-center gap-0.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              {isPaused
                ? <PlayCircle className="h-5 w-5 text-primary" />
                : <PauseCircle className="h-5 w-5 text-primary" />}
              {isPaused ? t('test.resume') : t('test.suspend')}
            </button>
          </div>

          {/* Next */}
          <button
            onClick={onForward}
            disabled={!canGoForward || isPaused}
            className={cn(
              'flex items-center justify-end gap-1.5 text-sm font-medium transition-colors',
              canGoForward && !isPaused ? 'text-slate-200 active:text-white' : 'text-slate-600 cursor-not-allowed',
            )}
          >
            {t('test.next')}
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </footer>
  );
}
