import React from 'react';
import { cn } from '@/lib/utils';

const ALLOWED_INLINE_TAGS = /^\/?(b|strong|i|em|u|span)$/i;

function sanitizeInlineHtml(html: string): string {
  return html.replace(/<([^>]+)>/g, (match, tag) => {
    const tagName = tag.trim().split(/[\s/]/)[0];
    return ALLOWED_INLINE_TAGS.test(tagName) ? match : '';
  });
}

/**
 * Renders question/bilingual text that may contain:
 * - A leading Q-number prefix (e.g. "Q81801\n\n") — stripped automatically
 * - <br><br> for paragraph breaks
 * - <br> for line breaks within a paragraph
 * - <b>, <strong>, <i>, <em>, <u> inline tags
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  // Strip leading Q-number prefix like "Q81801\n\n"
  const cleaned = text.replace(/^Q\d+\s*\n+/, '');

  // Split into paragraphs on double <br>
  const paragraphs = cleaned.split(/<br\s*\/?>\s*<br\s*\/?>/i);

  return (
    <div className={cn('space-y-5', className)}>
      {paragraphs.map((para, pi) => {
        // Split within paragraph on single <br>
        const lines = para.split(/<br\s*\/?>/i);
        return (
          <p key={pi}>
            {lines.map((line, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(line) }} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
