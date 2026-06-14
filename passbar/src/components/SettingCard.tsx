"use client";

import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── HintIcon ─────────────────────────────────────────────────────────────────

interface HintIconProps {
  children: React.ReactNode;
}

export function HintIcon({ children }: HintIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex cursor-help items-center text-primary"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        sideOffset={10}
        className="max-w-[calc(100vw-2rem)] border border-[#ebd9b8]/40 bg-gradient-to-br from-white to-[#faf6f0]/90 p-0 text-slate-700 shadow-[0_12px_40px_-12px_rgba(180,117,14,0.15)] backdrop-blur-xl rounded-xl ring-1 ring-black/5 overflow-hidden"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

// ── SettingCard ───────────────────────────────────────────────────────────────

interface SettingCardProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingCard({ label, hint, children, className }: SettingCardProps) {
  return (
    <div className={cn("rounded-xl border border-slate-200/60 bg-white px-5 py-4 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
        {label}
        {hint && (
          <HintIcon>
            <div className="max-w-[28rem] px-3 py-2 text-[13px] leading-relaxed text-slate-700">
              {hint}
            </div>
          </HintIcon>
        )}
      </div>
      {children}
    </div>
  );
}

// ── PillToggle ────────────────────────────────────────────────────────────────

export interface PillOption<T> {
  value: T;
  label: React.ReactNode;
  icon?: React.ElementType;
}

interface PillToggleProps<T> {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function PillToggle<T>({ options, value, onChange }: PillToggleProps<T>) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 self-start">
      {options.map((opt, i) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-150",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
