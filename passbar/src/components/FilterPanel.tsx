"use client";

import React from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FilterOption = {
  value: string;
  label: string;
};

export type FilterGroup = {
  /** Section label (shown in uppercase above chips) */
  label: string;
  options: FilterOption[];
};

export type FilterState = Map<string, Set<string>>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Count total active selections across all groups */
export function countActive(state: FilterState): number {
  let n = 0;
  for (const set of state.values()) n += set.size;
  return n;
}

/** Toggle a value within a group */
export function toggleFilter(
  state: FilterState,
  groupLabel: string,
  value: string,
): FilterState {
  const next = new Map(state);
  const set = new Set(next.get(groupLabel) ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  next.set(groupLabel, set);
  return next;
}

/** Clear all selections */
export function clearFilters(groups: FilterGroup[]): FilterState {
  return new Map(groups.map((g) => [g.label, new Set()]));
}

/** Build initial empty FilterState from groups */
export function initFilterState(groups: FilterGroup[]): FilterState {
  return new Map(groups.map((g) => [g.label, new Set<string>()]));
}

// ─── FilterChip ───────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-slate-200 bg-white text-slate-600 hover:border-primary/50 hover:bg-primary/5',
      )}
    >
      {label}
    </button>
  );
}

// ─── FilterButton ─────────────────────────────────────────────────────────────

export function FilterButton({
  open,
  count,
  label,
  onClick,
}: {
  open: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="h-9 gap-2 px-3 sm:px-4 relative shrink-0"
      onClick={onClick}
    >
      <SlidersHorizontal className="h-4 w-4 text-slate-500" />
      <span className="hidden sm:inline">{label}</span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {count}
        </span>
      )}
      <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', open && 'rotate-180')} />
    </Button>
  );
}

// ─── FilterPanel ──────────────────────────────────────────────────────────────

export type FilterPanelProps = {
  open: boolean;
  groups: FilterGroup[];
  state: FilterState;
  onToggle: (groupLabel: string, value: string) => void;
  onClear: () => void;
  clearLabel: string;
  filterLabel: string;
};

export function FilterPanel({
  open, groups, state, onToggle, onClear, clearLabel, filterLabel,
}: FilterPanelProps) {
  if (!open) return null;
  const totalActive = countActive(state);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-150">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{filterLabel}</p>
        {totalActive > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <X className="h-3 w-3" />
            {clearLabel}
          </button>
        )}
      </div>

      {groups.map((group, i) => (
        <React.Fragment key={group.label}>
          {i > 0 && <Separator />}
          <div className="space-y-3">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.options.map((opt) => (
                <FilterChip
                  key={opt.value}
                  label={opt.label}
                  active={state.get(group.label)?.has(opt.value) ?? false}
                  onClick={() => onToggle(group.label, opt.value)}
                />
              ))}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── ActiveFilterBadges ───────────────────────────────────────────────────────

export function ActiveFilterBadges({
  groups,
  state,
  onToggle,
  onClear,
  clearLabel,
}: {
  groups: FilterGroup[];
  state: FilterState;
  onToggle: (groupLabel: string, value: string) => void;
  onClear: () => void;
  clearLabel: string;
}) {
  const totalActive = countActive(state);
  if (totalActive === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {groups.map((group) =>
        Array.from(state.get(group.label) ?? []).map((val) => {
          const label = group.options.find((o) => o.value === val)?.label ?? val;
          return (
            <Badge key={`${group.label}:${val}`} variant="secondary" className="gap-1 pr-1">
              {label}
              <button type="button" onClick={() => onToggle(group.label, val)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        }),
      )}
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-slate-400 hover:text-primary transition-colors"
      >
        {clearLabel}
      </button>
    </div>
  );
}
