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

// ─── Question text highlight styles ──────────────────────────────────────────

function highlightClass(kind: QuestionHighlight['kind'], importance?: QuestionHighlight['importance']) {
  const strong = importance === 'high';
  switch (kind) {
    case 'key_sentence':
      return cn(
        'rounded bg-primary/10 px-1 box-decoration-clone shadow-[inset_0_-2px_0_hsl(var(--primary)/0.55)]',
        strong && 'bg-primary/15 shadow-[inset_0_-3px_0_hsl(var(--primary)/0.7)]'
      );
    case 'issue':
    case 'rule_trigger':
      return cn('rounded bg-amber-100 px-1 font-semibold text-slate-950 box-decoration-clone', strong && 'bg-amber-200');
    case 'fact_trigger':
      return cn('rounded bg-sky-100 px-1 font-medium text-slate-950 box-decoration-clone', strong && 'bg-sky-200');
    case 'keyword':
    default:
      return cn('rounded bg-primary/10 px-1 font-semibold text-slate-950 box-decoration-clone', strong && 'bg-primary/15');
  }
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
  // trap_phrase: only reveal after answer shown, with red wavy underline
  if (kind === 'trap_phrase') {
    if (state === 'neutral') return 'font-medium'; // subtle before reveal
    return 'underline decoration-red-400 decoration-2 font-medium text-red-700';
  }
  // On the correct choice: green text + underline
  if (state === 'correct') {
    return 'underline decoration-green-500 decoration-2 font-semibold text-green-700';
  }
  // Other kinds — color matches their semantic meaning
  switch (kind) {
    case 'legal_term':
      return 'font-semibold text-primary';
    case 'fact_trigger':
      return 'font-medium text-sky-700';
    case 'procedural_posture':
      return 'font-medium text-amber-700';
    case 'remedy_or_relief':
      return 'font-medium text-violet-700';
    default:
      return 'font-medium text-slate-700';
  }
}

// ─── Tooltip popover (shared) ─────────────────────────────────────────────────

function tooltipLabelColor(kind: string): string {
  switch (kind) {
    case 'key_sentence': return 'text-primary';
    case 'issue':
    case 'rule_trigger': return 'text-amber-700';
    case 'fact_trigger': return 'text-sky-700';
    case 'trap_phrase':  return 'text-red-600';
    case 'legal_term':   return 'text-primary';
    case 'procedural_posture': return 'text-amber-700';
    case 'remedy_or_relief':   return 'text-violet-700';
    default:             return 'text-slate-800';
  }
}

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
  pos,
  language,
}: {
  label?: LocalizedText;
  reason?: LocalizedText;
  kind?: string;
  pos: TooltipPos;
  language?: string;
}) {
  const displayLabel = localizedValue(label, language);
  const displayReason = localizedValue(reason, language);
  if (!pos || (!displayLabel && !displayReason)) return null;
  return (
    <span
      className={cn(
        'fixed z-[9999] w-56 pointer-events-none',
        'rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg',
        'animate-in fade-in zoom-in-95 duration-100',
      )}
      style={{ top: pos.top, left: pos.left }}
    >
      {displayLabel && (
        <span className={cn('block text-xs font-semibold leading-snug', kind ? tooltipLabelColor(kind) : 'text-slate-800')}>{displayLabel}</span>
      )}
      {displayReason && (
        <span className="block text-xs text-slate-500 mt-1 leading-snug">{displayReason}</span>
      )}
    </span>
  );
}

function useTooltipPos() {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<TooltipPos>(null);

  const hide = useCallback(() => setPos(null), []);

  const show = useCallback((e: React.MouseEvent) => {
    const TIP_W = 224;
    const TIP_H = 90;
    const GAP = 12;
    const MARGIN = 8;

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
      <TooltipContent label={hl.label} reason={hl.reason} kind={hl.kind} pos={pos} language={language} />
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
      <TooltipContent label={kw.label} reason={kw.reason} kind={kw.kind} pos={pos} language={language} />
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
