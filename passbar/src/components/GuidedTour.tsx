"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

export type GuidedTourStep = {
  selector: string;
  title: string;
  description: string;
};

type GuidedTourProps = {
  open: boolean;
  steps: GuidedTourStep[];
  onOpenChange: (open: boolean) => void;
  stepLabel: (current: number, total: number) => string;
  backLabel: string;
  nextLabel: string;
  doneLabel: string;
};

type TourRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const EMPTY_RECT: TourRect = {
  top: 120,
  left: 24,
  width: 0,
  height: 0,
};

export function GuidedTour({
  open,
  steps,
  onOpenChange,
  stepLabel,
  backLabel,
  nextLabel,
  doneLabel,
}: GuidedTourProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TourRect>(EMPTY_RECT);
  const activeStep = steps[activeIndex];
  const viewport = typeof window === 'undefined'
    ? { width: 1024, height: 768 }
    : { width: window.innerWidth, height: window.innerHeight };

  const updateTargetRect = () => {
    if (!activeStep) return;

    const target = document.querySelector<HTMLElement>(activeStep.selector);
    if (!target) {
      setTargetRect({
        top: Math.max(window.innerHeight * 0.2, 96),
        left: Math.max(window.innerWidth * 0.08, 24),
        width: 0,
        height: 0,
      });
      return;
    }

    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    }, 120);
  };

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updateTargetRect();

    const handleUpdate = () => updateTargetRect();
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [open, activeIndex, activeStep?.selector]);

  const highlightStyle = useMemo(() => {
    const padding = 10;
    return {
      top: `${Math.max(targetRect.top - padding, 12)}px`,
      left: `${Math.max(targetRect.left - padding, 12)}px`,
      width: `${Math.max(targetRect.width + padding * 2, 140)}px`,
      height: `${Math.max(targetRect.height + padding * 2, 54)}px`,
    };
  }, [targetRect]);

  const panelStyle = useMemo(() => {
    const panelWidth = Math.min(380, Math.max(viewport.width - 32, 280));
    const sideGap = 18;
    const fitsRight = targetRect.left + targetRect.width + sideGap + panelWidth < viewport.width - 16;
    const fitsLeft = targetRect.left - sideGap - panelWidth > 16;
    const left = fitsRight
      ? targetRect.left + targetRect.width + sideGap
      : fitsLeft
        ? targetRect.left - sideGap - panelWidth
        : Math.max((viewport.width - panelWidth) / 2, 16);
    const top = Math.min(Math.max(targetRect.top, 76), viewport.height - 260);

    return {
      width: `${panelWidth}px`,
      left: `${left}px`,
      top: `${top}px`,
    };
  }, [targetRect, viewport.height, viewport.width]);

  if (!open || !activeStep) return null;

  const isFirst = activeIndex === 0;
  const isLast = activeIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/45" />
      <div
        className="pointer-events-none absolute rounded-lg border-2 border-primary bg-primary/5 shadow-[0_0_0_4px_rgba(201,151,35,0.18),0_0_24px_rgba(201,151,35,0.78)]"
        style={highlightStyle}
      />
      <div
        className="pointer-events-auto absolute rounded-lg border border-slate-200 bg-white text-slate-700 shadow-2xl"
        style={panelStyle}
      >
        <div className="relative p-5">
          <button
            type="button"
            className="absolute right-4 top-4 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            onClick={() => onOpenChange(false)}
            aria-label="Close tutorial"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="pr-8">
            <p className="text-sm font-bold uppercase tracking-wider text-primary">
              {stepLabel(activeIndex + 1, steps.length)}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">{activeStep.title}</h2>
            <p className="mt-3 text-base leading-relaxed text-slate-600">{activeStep.description}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-b-lg bg-slate-50 px-5 py-4">
          <span className="text-sm font-semibold text-slate-500">
            {stepLabel(activeIndex + 1, steps.length)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isFirst}
              onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))}
              className={cn(isFirst && 'opacity-50')}
            >
              {backLabel}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (isLast) onOpenChange(false);
                else setActiveIndex((index) => Math.min(index + 1, steps.length - 1));
              }}
            >
              {isLast ? doneLabel : nextLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
