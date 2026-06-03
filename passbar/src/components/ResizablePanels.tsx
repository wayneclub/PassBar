"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ResizablePanelsProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftPct?: number;
  minPx?: number;
  className?: string;
  /** Only shows side-by-side layout when true */
  enabled?: boolean;
}

export function ResizablePanels({
  left,
  right,
  defaultLeftPct = 50,
  minPx = 280,
  className,
  enabled = true,
}: ResizablePanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(defaultLeftPct);
  const [isMobile, setIsMobile] = useState(false);
  const dragging = useRef(false);

  // Detect mobile (< 1024px = lg breakpoint)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rawPct = ((e.clientX - rect.left) / rect.width) * 100;
    const minPct = (minPx / rect.width) * 100;
    const maxPct = 100 - minPct;
    setLeftPct(Math.min(maxPct, Math.max(minPct, rawPct)));
  }, [minPx]);

  const stopDrag = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, [onPointerMove, stopDrag]);

  // Mobile or disabled: vertical stack with single unified scroll.
  // Override h-full / overflow-y-auto on the direct div children passed
  // as props so they flow naturally instead of creating nested scroll areas.
  if (!enabled || isMobile) {
    return (
      <div className={cn('h-full w-full overflow-y-auto', className)}>
        <div className="[&>div]:!h-auto [&>div]:!overflow-y-visible">
          {left}
        </div>
        <div className="[&>div]:!h-auto [&>div]:!overflow-y-visible">
          {right}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('flex h-full w-full overflow-hidden', className)}>
      {/* Left panel */}
      <div className="h-full overflow-hidden" style={{ width: `${leftPct}%`, flexShrink: 0 }}>
        {left}
      </div>

      {/* Drag handle — hidden on mobile via isMobile check above */}
      <div
        className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-slate-100 hover:bg-primary/10 active:bg-primary/20 transition-colors"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      >
        <div className="flex flex-col items-center gap-[3px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-primary/60 transition-colors"
            />
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="h-full min-w-0 flex-1 overflow-hidden">
        {right}
      </div>
    </div>
  );
}
