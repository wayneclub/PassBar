"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { 
  ChevronLeft, 
  ChevronRight, 
  MessageSquare, 
  CirclePower,
  PauseCircle
} from 'lucide-react';

interface TestFooterProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSuspend: () => void;
  onEnd: () => void;
  onSubmit: () => void;
  showSubmit: boolean;
  isTutorMode: boolean;
}

export function TestFooter({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSuspend,
  onEnd,
}: TestFooterProps) {
  return (
    <footer className="h-16 bg-[#1a2b3c] text-white border-t border-slate-700 flex items-center justify-between px-6 fixed bottom-0 w-full z-50">
      <div className="flex items-center gap-6">
        <button 
          onClick={onEnd}
          className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
        >
          <div className="w-5 h-5 rounded-full border border-blue-400 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
          </div>
          End
        </button>
        <button 
          onClick={onSuspend}
          className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
        >
          <PauseCircle className="w-5 h-5 text-blue-400" />
          Suspend
        </button>
      </div>

      <div className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white cursor-pointer transition-colors">
        <MessageSquare className="w-5 h-5 text-blue-400" />
        Feedback
      </div>

      <div className="flex items-center gap-6">
        <button 
          onClick={onBack}
          disabled={!canGoBack}
          className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          Previous
        </button>
        <button 
          onClick={onForward}
          disabled={!canGoForward}
          className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </footer>
  );
}
