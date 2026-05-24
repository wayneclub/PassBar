"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Settings, 
  Layout, 
  HelpCircle, 
  Bookmark, 
  Zap, 
  FileText, 
  SquarePen,
  ChevronDown
} from 'lucide-react';

interface TestHeaderProps {
  questionIndex: number;
  totalQuestions: number;
  timeSpent: number;
  onTimeUpdate: (time: number) => void;
  isPaused: boolean;
}

export function TestHeader({ 
  questionIndex, 
  totalQuestions, 
  timeSpent, 
  onTimeUpdate,
  isPaused 
}: TestHeaderProps) {
  const [localTime, setLocalTime] = useState(timeSpent);

  useEffect(() => {
    if (isPaused) return;
    
    const interval = setInterval(() => {
      setLocalTime(prev => {
        const next = prev + 1;
        onTimeUpdate(next);
        return next;
      });
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
    <header className="h-14 bg-[#1a2b3c] text-white flex items-center justify-between px-4 fixed top-0 w-full z-50">
      {/* Left Icons */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="hover:bg-white/10 text-blue-400">
          <Bookmark className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-white/10 text-blue-400">
          <Zap className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-white/10 text-blue-400">
          <FileText className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-white/10 text-blue-400">
          <SquarePen className="w-5 h-5" />
        </Button>
      </div>

      {/* Center Navigation */}
      <div className="flex items-center gap-1 cursor-pointer hover:bg-white/5 px-3 py-1 rounded transition-colors">
        <span className="text-sm font-medium">{questionIndex + 1}/{totalQuestions}</span>
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </div>

      {/* Right Icons */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="hover:bg-white/10 text-blue-400 h-9 w-9">
            <HelpCircle className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hover:bg-white/10 text-blue-400 h-9 w-9">
            <Settings className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hover:bg-white/10 text-blue-400 h-9 w-9">
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
