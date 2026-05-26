"use client";

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { 
  ChevronLeft, 
  ChevronRight, 
  MessageSquare, 
  PauseCircle,
  PlayCircle,
  Send
} from 'lucide-react';

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
}: TestFooterProps) {
  const { t } = useI18n();
  return (
    <footer className="fixed bottom-0 z-50 grid h-20 w-full grid-cols-[1fr_auto_1fr] items-center border-t border-slate-700 bg-[#1a2b3c] px-6 text-white shadow-lg">
      <div className="flex items-center gap-5">
        <button 
          onClick={onEnd}
          className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
        >
          <div className="w-5 h-5 rounded-full border border-blue-400 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
          </div>
          {t('test.end')}
        </button>
        <button 
          onClick={onSuspend}
          className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
        >
          {isPaused ? <PlayCircle className="w-5 h-5 text-blue-400" /> : <PauseCircle className="w-5 h-5 text-blue-400" />}
          {isPaused ? t('test.resume') : t('test.suspend')}
        </button>
      </div>

      <div className="flex min-w-[260px] justify-center">
        {showSubmit ? (
          <button
            onClick={onSubmit}
            className="flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-md bg-primary px-8 text-base font-bold text-white shadow-md transition-colors hover:bg-primary/90"
          >
            <Send className="h-5 w-5" />
            {t('test.submit')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onFeedback}
            disabled={feedbackLoading || isPaused}
            className="flex items-center gap-2 text-sm font-medium text-slate-300 transition-colors hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            <MessageSquare className="w-5 h-5 text-blue-400" />
            {feedbackLoading ? t('test.generatingFeedback') : t('test.feedback')}
          </button>
        )}
      </div>

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
    </footer>
  );
}
