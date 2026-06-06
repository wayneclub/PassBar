'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { LocalizedText, QuestionHighlight, QuestionKeyword } from '@/lib/types';

const ALLOWED_INLINE_TAGS = /^\/?(b|strong|i|em|u|span)$/i;

function sanitizeInlineHtml(html: string): string {
  return html.replace(/<([^>]+)>/g, (match, tag) => {
    const tagName = tag.trim().split(/[\s/]/)[0];
    return ALLOWED_INLINE_TAGS.test(tagName) ? match : '';
  });
}

function stripInlineHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

// ─── Kind config (bilingual label + color) ───────────────────────────────────

type KindConfig = {
  label: { en: string; zh: string };
  chipClass: string;       // badge chip style
  highlightClass: string;  // question text mark
  choiceClass: string;     // choice keyword style
};

const KIND_CONFIG: Record<string, KindConfig> = {
  key_sentence: {
    label: { en: 'Key Rule', zh: '核心規則' },
    chipClass: 'bg-primary/10 text-primary border-primary/20',
    highlightClass: 'rounded bg-primary/10 px-0.5 box-decoration-clone shadow-[inset_0_-2px_0_hsl(var(--primary)/0.5)] font-medium text-slate-900',
    choiceClass: 'font-semibold text-primary',
  },
  issue: {
    label: { en: 'Legal Issue', zh: '爭議焦點' },
    chipClass: 'bg-amber-50 text-amber-700 border-amber-200',
    highlightClass: 'rounded bg-amber-100 px-0.5 font-semibold text-slate-900 box-decoration-clone',
    choiceClass: 'font-semibold text-amber-700',
  },
  rule_trigger: {
    label: { en: 'Rule Trigger', zh: '規則觸發' },
    chipClass: 'bg-amber-50 text-amber-700 border-amber-200',
    highlightClass: 'rounded bg-amber-100 px-0.5 font-semibold text-slate-900 box-decoration-clone',
    choiceClass: 'font-semibold text-amber-700',
  },
  fact_trigger: {
    label: { en: 'Fact Trigger', zh: '事實要素' },
    chipClass: 'bg-sky-50 text-sky-700 border-sky-200',
    highlightClass: 'rounded bg-sky-100 px-0.5 font-medium text-slate-900 box-decoration-clone',
    choiceClass: 'font-medium text-sky-700',
  },
  keyword: {
    label: { en: 'Key Term', zh: '關鍵詞' },
    chipClass: 'bg-primary/10 text-primary border-primary/20',
    highlightClass: 'rounded bg-primary/8 px-0.5 font-semibold text-slate-900 box-decoration-clone',
    choiceClass: 'font-semibold text-primary',
  },
  legal_term: {
    label: { en: 'Legal Term', zh: '法律術語' },
    chipClass: 'bg-primary/10 text-primary border-primary/20',
    highlightClass: 'rounded bg-primary/8 px-0.5 font-semibold text-slate-900 box-decoration-clone',
    choiceClass: 'font-semibold text-primary',
  },
  procedural_posture: {
    label: { en: 'Procedural Posture', zh: '程序態勢' },
    chipClass: 'bg-amber-50 text-amber-700 border-amber-200',
    highlightClass: 'rounded bg-amber-50 px-0.5 font-medium text-amber-900 box-decoration-clone',
    choiceClass: 'font-medium text-amber-700',
  },
  trap_phrase: {
    label: { en: 'Trap Phrase', zh: '陷阱選項' },
    chipClass: 'bg-red-50 text-red-600 border-red-200',
    highlightClass: 'rounded bg-red-50 px-0.5 font-medium text-red-800 box-decoration-clone',
    choiceClass: 'font-medium text-red-700 underline decoration-red-400 decoration-2',
  },
  remedy_or_relief: {
    label: { en: 'Remedy / Relief', zh: '救濟方式' },
    chipClass: 'bg-violet-50 text-violet-700 border-violet-200',
    highlightClass: 'rounded bg-violet-50 px-0.5 font-medium text-violet-900 box-decoration-clone',
    choiceClass: 'font-medium text-violet-700',
  },
  party_role: {
    label: { en: 'Party Role', zh: '當事人角色' },
    chipClass: 'bg-slate-100 text-slate-700 border-slate-200',
    highlightClass: 'rounded bg-slate-100 px-0.5 font-medium text-slate-900 box-decoration-clone',
    choiceClass: 'font-medium text-slate-700',
  },
  time_marker: {
    label: { en: 'Time Marker', zh: '時間標記' },
    chipClass: 'bg-slate-100 text-slate-600 border-slate-200',
    highlightClass: 'rounded bg-slate-100 px-0.5 font-medium text-slate-800 box-decoration-clone',
    choiceClass: 'font-medium text-slate-600',
  },
};

function getKindConfig(kind: string): KindConfig {
  return KIND_CONFIG[kind] ?? KIND_CONFIG.keyword;
}

// ─── Question text highlight styles ──────────────────────────────────────────

function highlightClass(kind: QuestionHighlight['kind'], importance?: QuestionHighlight['importance']) {
  const base = getKindConfig(kind).highlightClass;
  if (importance === 'high') return cn(base, 'shadow-[inset_0_-2px_0_currentColor/40]');
  return base;
}

// ─── Choice keyword styles ────────────────────────────────────────────────────

/**
 * choiceState:
 *  'neutral'  — not yet revealed
 *  'correct'  — this choice is the correct answer (after reveal)
 *  'wrong'    — this choice was selected but wrong (after reveal)
 *  'unselected' — revealed but neither selected nor correct
 */
export type ChoiceState = 'neutral' | 'correct' | 'wrong' | 'unselected';

function choiceKeywordClass(kind: QuestionKeyword['kind'], state: ChoiceState): string {
  if (kind === 'trap_phrase') {
    if (state === 'neutral') return 'font-medium';
    return getKindConfig('trap_phrase').choiceClass;
  }
  if (state === 'correct') {
    return cn(getKindConfig(kind).choiceClass, 'underline decoration-green-500 decoration-2 text-green-700');
  }
  return getKindConfig(kind).choiceClass;
}

// ─── Tooltip popover (shared) ─────────────────────────────────────────────────

const IMPORTANCE_CONFIG = {
  high:   { label: { en: 'HIGH',   zh: '高' }, chipClass: 'bg-red-50 text-red-600 border-red-200' },
  medium: { label: { en: 'MEDIUM', zh: '中' }, chipClass: 'bg-amber-50 text-amber-600 border-amber-200' },
  low:    { label: { en: 'LOW',    zh: '低' }, chipClass: 'bg-slate-100 text-slate-500 border-slate-200' },
} as const;

type TooltipPos = { top: number; left: number } | null;

function localizedValue(value: LocalizedText | undefined, language = 'en'): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  const preferredKeys = language === 'en' ? ['en', 'zh'] : ['zh', 'en'];
  for (const key of preferredKeys) {
    const text = value[key as keyof typeof value];
    if (text) return text;
  }
  return undefined;
}

function TooltipContent({
  label,
  reason,
  kind,
  importance,
  pos,
  language,
}: {
  label?: LocalizedText;
  reason?: LocalizedText;
  kind?: string;
  importance?: 'high' | 'medium' | 'low';
  pos: TooltipPos;
  language?: string;
}) {
  const displayLabel = localizedValue(label, language);
  const displayReason = localizedValue(reason, language);
  if (!pos || (!displayLabel && !displayReason)) return null;

  const isZh = language !== 'en';
  const cfg = kind ? getKindConfig(kind) : null;
  const impCfg = importance ? IMPORTANCE_CONFIG[importance] : null;

  // Importance dots: low=1, medium=2, high=3
  const impDots = importance === 'high' ? 3 : importance === 'medium' ? 2 : importance === 'low' ? 1 : 0;
  const impDotColor = importance === 'high' ? 'bg-red-400' : importance === 'medium' ? 'bg-amber-400' : 'bg-slate-300';

  return (
    <span
      className={cn(
        'fixed z-[9999] pointer-events-none',
        'w-[min(16rem,calc(100vw-2rem))]',   // max 256px, but never wider than viewport
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        'animate-in fade-in zoom-in-95 duration-100',
      )}
      style={{ top: pos.top, left: pos.left }}
    >
      <span className="block px-3.5 pt-3 pb-3 space-y-1.5">
        {/* Title */}
        {displayLabel && (
          <span className="block text-sm font-bold leading-snug text-slate-900">
            {displayLabel}
          </span>
        )}
        {/* Reason */}
        {displayReason && (
          <span className="block text-xs leading-relaxed text-slate-500">
            {displayReason}
          </span>
        )}
        {/* Bottom row: dots left, kind pill right */}
        {(impDots > 0 || cfg) && (
          <span className="flex items-center justify-between pt-1">
            {/* Dots — always reserve space so pill stays right even without dots */}
            <span className="flex items-center gap-0.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    impDots > 0
                      ? i < impDots ? impDotColor : 'bg-slate-100'
                      : 'hidden',
                  )}
                />
              ))}
            </span>
            {cfg && (
              <span className="inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {isZh ? cfg.label.zh : cfg.label.en}
              </span>
            )}
          </span>
        )}
      </span>
    </span>
  );
}

function useTooltipPos() {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<TooltipPos>(null);

  const hide = useCallback(() => setPos(null), []);

  const show = useCallback((e: React.MouseEvent) => {
    const MARGIN = 16;
    const TIP_W = Math.min(256, window.innerWidth - MARGIN * 2);
    const TIP_H = 110;
    const GAP = 10;

    let top = e.clientY - TIP_H - GAP;
    if (top < MARGIN) top = e.clientY + GAP + 16;

    let left = e.clientX;
    if (left + TIP_W > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - TIP_W;
    if (left < MARGIN) left = MARGIN;

    setPos({ top, left });
  }, []);

  // Hide on scroll or touch — covers mobile scroll-while-tooltip-visible
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    window.addEventListener('touchstart', hide, { passive: true });
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('touchstart', hide);
    };
  }, [pos, hide]);

  return { wrapperRef, pos, show, hide };
}

// ─── Question text highlight mark ────────────────────────────────────────────

type MatchRange = {
  start: number;
  end: number;
  highlight: QuestionHighlight;
};

function getHighlightRanges(line: string, highlights: QuestionHighlight[]): MatchRange[] {
  const lowerLine = line.toLowerCase();
  const ranges: MatchRange[] = [];
  const ordered = [...highlights]
    .filter((highlight) => highlight.text.trim())
    .sort((a, b) => b.text.length - a.text.length);

  for (const highlight of ordered) {
    const needle = highlight.text.trim().toLowerCase();
    let fromIndex = 0;
    let seen = 0;

    while (fromIndex < lowerLine.length) {
      const start = lowerLine.indexOf(needle, fromIndex);
      if (start < 0) break;
      const end = start + needle.length;
      seen += 1;
      fromIndex = end;

      if (highlight.occurrence && highlight.occurrence !== seen) continue;
      if (ranges.some((range) => start < range.end && end > range.start)) continue;

      ranges.push({ start, end, highlight });
      if (highlight.occurrence) break;
    }
  }

  return ranges.sort((a, b) => a.start - b.start);
}

function HighlightMark({ range, text, language }: { range: MatchRange; text: string; language?: string }) {
  const { wrapperRef, pos, show, hide } = useTooltipPos();
  const hl = range.highlight;
  return (
    <span ref={wrapperRef} className="relative inline" onMouseMove={show} onMouseLeave={hide}>
      <mark
        className={cn(highlightClass(hl.kind, hl.importance), 'cursor-default')}
        data-highlight-kind={hl.kind}
      >
        {text}
      </mark>
      <TooltipContent label={hl.label} reason={hl.reason} kind={hl.kind} importance={hl.importance} pos={pos} language={language} />
    </span>
  );
}

function renderHighlightedLine(line: string, highlights: QuestionHighlight[], language?: string) {
  const plainLine = stripInlineHtml(line);
  const ranges = getHighlightRanges(plainLine, highlights);
  if (ranges.length === 0) return plainLine;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(plainLine.slice(cursor, range.start));
    }
    nodes.push(
      <HighlightMark
        key={`${range.start}-${range.end}-${index}`}
        range={range}
        text={plainLine.slice(range.start, range.end)}
        language={language}
      />
    );
    cursor = range.end;
  });

  if (cursor < plainLine.length) {
    nodes.push(plainLine.slice(cursor));
  }

  return nodes;
}

// ─── Choice keyword mark ──────────────────────────────────────────────────────

type KeywordRange = {
  start: number;
  end: number;
  keyword: QuestionKeyword;
};

function getKeywordRanges(text: string, keywords: QuestionKeyword[]): KeywordRange[] {
  const lower = text.toLowerCase();
  const ranges: KeywordRange[] = [];
  const ordered = [...keywords]
    .filter((k) => k.text.trim())
    .sort((a, b) => b.text.length - a.text.length);

  for (const keyword of ordered) {
    const needle = keyword.text.trim().toLowerCase();
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const end = start + needle.length;
    if (ranges.some((r) => start < r.end && end > r.start)) continue;
    ranges.push({ start, end, keyword });
  }

  return ranges.sort((a, b) => a.start - b.start);
}

function ChoiceKeywordMark({ kw, text, state, language }: { kw: QuestionKeyword; text: string; state: ChoiceState; language?: string }) {
  const { wrapperRef, pos, show, hide } = useTooltipPos();
  return (
    <span ref={wrapperRef} className="relative inline" onMouseMove={show} onMouseLeave={hide}>
      <span className={cn(choiceKeywordClass(kw.kind, state), 'cursor-default')}>
        {text}
      </span>
      <TooltipContent label={kw.label} reason={kw.reason} kind={kw.kind} importance={kw.importance} pos={pos} language={language} />
    </span>
  );
}

function renderChoiceText(text: string, keywords: QuestionKeyword[], state: ChoiceState, language?: string) {
  const ranges = getKeywordRanges(text, keywords);
  if (ranges.length === 0) return text;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <ChoiceKeywordMark
        key={`${range.start}-${index}`}
        kw={range.keyword}
        text={text.slice(range.start, range.end)}
        state={state}
        language={language}
      />
    );
    cursor = range.end;
  });

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// ─── Public components ────────────────────────────────────────────────────────

/**
 * Renders question stem text with phrase highlights and keyword annotations.
 */
function RichTextComponent({
  text,
  className,
  highlights,
  language,
}: {
  text: string;
  className?: string;
  highlights?: QuestionHighlight[];
  language?: string;
}) {
  const cleaned = text.replace(/^Q\d+\s*\n+/, '');
  const paragraphs = cleaned.split(/<br\s*\/?>\s*<br\s*\/?>/i);

  return (
    <div className={cn('space-y-5', className)}>
      {paragraphs.map((para, pi) => {
        const lines = para.split(/<br\s*\/?>/i);
        return (
          <p key={pi}>
            {lines.map((line, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {highlights?.length ? (
                  <span>{renderHighlightedLine(line, highlights, language)}</span>
                ) : (
                  <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(line) }} />
                )}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Renders a single choice option text with keyword annotations.
 *
 * @param text     The choice text (EN), with leading "A. " prefix already stripped.
 * @param keywords Keywords for this specific choice from choiceKeywordMeta.
 * @param state    Whether this choice is correct / wrong / neutral after reveal.
 */
function ChoiceTextComponent({
  text,
  keywords,
  state = 'neutral',
  className,
  language,
}: {
  text: string;
  keywords?: QuestionKeyword[];
  state?: ChoiceState;
  className?: string;
  language?: string;
}) {
  if (!keywords?.length) return <span className={className}>{text}</span>;
  return <span className={className}>{renderChoiceText(text, keywords, state, language)}</span>;
}

export const RichText = React.memo(RichTextComponent);
export const ChoiceText = React.memo(ChoiceTextComponent);
