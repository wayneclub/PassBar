"use client";

import React, { useEffect, useRef, useState } from 'react';

import { Question } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import type { ContentMode, DisplayOptions, TextSize } from '@/lib/study-settings';
import { defaultStudySettings } from '@/lib/study-settings';
import { requestGeminiQuestionAnalysis } from '@/lib/gemini-feedback';
import {
  getCachedQuestionAiAnalysis,
  saveQuestionAiAnalysis,
} from '@/lib/question-ai-analysis';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import ReactMarkdown from 'react-markdown';

interface ExplanationViewProps {
  question: Question;
  userAnswer: string;
  selectedChoiceKey?: string | null;
  correctChoiceKey?: string | null;
  activeChoiceKey?: string | null;
  display?: DisplayOptions;
  contentMode?: ContentMode;
  textSize?: TextSize;
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function GeminiQuestionFeedback({
  question,
  selectedChoiceKey,
  correctChoiceKey,
  textSize
}: {
  question: Question;
  selectedChoiceKey?: string | null;
  correctChoiceKey?: string | null;
  textSize?: TextSize;
}) {
  const { t, language } = useI18n();
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function loadFeedback() {
      try {
        setLoading(true);
        setError(null);
        
        setFeedback(null);

        const options = question.options.map((text, idx) => ({
          key: String.fromCharCode(65 + idx),
          text
        }));
        const explanationText = stripHtml(question.enExplanationHtml ?? question.explanationHtml ?? '');
        const isCorrect = Boolean(
          selectedChoiceKey
          && correctChoiceKey
          && selectedChoiceKey.toUpperCase() === correctChoiceKey.toUpperCase()
        );

        const cached = await getCachedQuestionAiAnalysis({
          questionId: question.id,
          selectedChoice: selectedChoiceKey,
          correctChoice: correctChoiceKey,
          isCorrect,
          interfaceLanguage: language,
        });

        if (cached) {
          if (isMounted) setFeedback(cached);
          return;
        }

        const result = await requestGeminiQuestionAnalysis({
          questionText: question.questionText,
          options,
          selectedChoice: selectedChoiceKey,
          correctChoice: correctChoiceKey,
          isCorrect,
          explanationText,
          topic: question.chapterName,
          interfaceLanguage: language
        });
        
        if (isMounted) {
          setFeedback(result);
        }

        await saveQuestionAiAnalysis({
          questionId: question.id,
          selectedChoice: selectedChoiceKey,
          correctChoice: correctChoiceKey,
          isCorrect,
          interfaceLanguage: language,
          analysisMarkdown: result,
        });
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : t('explanation.geminiError'));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadFeedback();
    
    return () => {
      isMounted = false;
    };
  }, [question, selectedChoiceKey, correctChoiceKey, language]);

  const textClass = {
    small: 'text-[15px] leading-[1.7]',
    medium: 'text-[16px] leading-[1.8]',
    large: 'text-[18px] leading-[1.9]',
  }[textSize || 'medium'];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-primary/20 pb-3">
        <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('explanation.geminiFeedback')}</p>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-primary/70" />}
      </div>

      {loading && !feedback && (
        <div className={cn('text-muted-foreground animate-pulse', textClass)}>
          {t('explanation.geminiLoading')}
        </div>
      )}

      {error && !feedback && !loading && (
        <div className={cn('text-sm text-muted-foreground italic', textClass)}>
          {/* Silently hide backend errors — user sees HTML explanation instead */}
        </div>
      )}

      {feedback && (
        <div className={cn(
          'prose prose-slate max-w-none text-slate-800',
          'prose-headings:font-bold prose-headings:text-slate-900',
          'prose-strong:text-slate-900 prose-strong:font-semibold',
          'prose-li:my-1 prose-ul:my-3 prose-ol:my-3',
          'prose-p:my-3',
          textClass,
        )}>
          <ReactMarkdown>{feedback}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function buildIframeResizeScript(channelId: string) {
  return `
<style>
[data-choice].pbx-choice-active {
  background-color: rgba(185, 138, 29, 0.16) !important;
  outline: 2px solid rgba(185, 138, 29, 0.82) !important;
  outline-offset: 4px !important;
  box-shadow: 0 0 0 5px rgba(185, 138, 29, 0.12) !important;
  border-radius: 8px !important;
  transition: background-color 140ms ease, outline-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}
[data-choice].pbx-choice-active[data-choice-role="correct"] {
  background-color: rgba(34, 197, 94, 0.14) !important;
  outline-color: rgba(34, 197, 94, 0.8) !important;
  box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.1) !important;
}
[data-choice].pbx-choice-active[data-choice-role="distractor"],
[data-choice].pbx-choice-active[data-choice-role="wrong"] {
  background-color: rgba(239, 68, 68, 0.12) !important;
  outline-color: rgba(239, 68, 68, 0.72) !important;
  box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.08) !important;
}
.teacher-note-box {
  transition: opacity 0.2s ease, transform 0.2s ease !important;
}
.teacher-note-box.collapsed {
  display: none !important;
}
[onclick^="toggleNote"], .highlight-yellow, .highlight-blue, .teacher-note-box {
  cursor: pointer !important;
}
[onclick^="toggleNote"]:hover, .highlight-yellow:hover, .highlight-blue:hover {
  opacity: 0.85 !important;
  filter: brightness(0.95);
}
.teacher-note-box:hover {
  filter: brightness(0.98);
}
</style>
<script>
(function(){
  var ch = ${JSON.stringify(channelId)};
  var lastH = 0;
  var lastChoice = '';
  var pending = false;

  function contentHeight(){
    if (!document.body) return 0;
    var bodyTop = document.body.getBoundingClientRect().top;
    var maxBottom = 0;
    var nodes = document.body.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        maxBottom = Math.max(maxBottom, r.bottom - bodyTop);
      }
    }
    return Math.ceil(maxBottom);
  }

  function send(){
    pending = false;
    var h = contentHeight();
    if (h > 0 && Math.abs(h - lastH) > 1) {
      lastH = h;
      window.parent.postMessage({type:'passbar-html-resize', ch:ch, height:h}, '*');
    }
  }

  function schedule(){
    if (pending) return;
    pending = true;
    requestAnimationFrame(send);
  }

  function choiceMatches(value, choice) {
    if (!value || !choice) return false;
    return value.split(/[\\s,|/]+/).map(function(part){ return part.trim().toUpperCase(); }).indexOf(choice) !== -1;
  }

  function setActiveChoice(choice) {
    choice = choice ? String(choice).trim().toUpperCase() : '';
    var nodes = document.querySelectorAll('[data-choice]');
    var firstActive = null;
    for (var i = 0; i < nodes.length; i++) {
      var active = choiceMatches(nodes[i].getAttribute('data-choice'), choice);
      nodes[i].classList.toggle('pbx-choice-active', active);
      if (active && !firstActive) firstActive = nodes[i];
    }
    if (choice && firstActive && choice !== lastChoice) {
      var bodyTop = document.body ? document.body.getBoundingClientRect().top : 0;
      var rect = firstActive.getBoundingClientRect();
      window.parent.postMessage({
        type:'passbar-choice-focus',
        ch:ch,
        choice:choice,
        top:rect.top - bodyTop,
        height:rect.height
      }, '*');
    }
    lastChoice = choice;
    schedule();
  }

  window.toggleNote = function(index) {
    var notes = document.querySelectorAll('#note-zh-' + index + ', #note-en-' + index + ', .note-box-' + index);
    notes.forEach(function(note) {
      note.classList.toggle('collapsed');
    });
    schedule();
  };

  window.addEventListener('load', schedule);
  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('message', function(event) {
    if (!event.data) return;
    if (event.data.type === 'passbar-choice-hover') {
      setActiveChoice(event.data.choice || '');
    } else if (event.data.type === 'passbar-toggle-note') {
      window.toggleNote(event.data.index);
    }
  });
  new MutationObserver(schedule).observe(document.documentElement, {childList:true, subtree:true, attributes:true, characterData:true});
  if (window.ResizeObserver) {
    new ResizeObserver(schedule).observe(document.documentElement);
    if (document.body) new ResizeObserver(schedule).observe(document.body);
  }
  [50,150,350,700,1200,2000].forEach(function(t){ setTimeout(schedule, t); });
})();
</script>`;
}

function injectIframeResizeScript(html: string, channelId: string) {
  const script = buildIframeResizeScript(channelId);
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/(<head(\s[^>]*)?>)/i, `$1${script}`);
  }
  return script + html;
}

const HtmlPanel = React.memo(function HtmlPanel({ html, title, activeChoiceKey, minHeight = 80 }: { html: string; title: string; activeChoiceKey?: string | null; minHeight?: number }) {
  const channelId = React.useMemo(() => `html-${Math.random().toString(36).slice(2)}`, [html]);
  const srcDoc = React.useMemo(() => injectIframeResizeScript(html, channelId), [channelId, html]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(minHeight);

  useEffect(() => {
    setHeight(minHeight);
  }, [html, minHeight]);

  useEffect(() => {
    function findScrollParent(element: HTMLElement | null): HTMLElement | Window {
      let current = element?.parentElement ?? null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (/(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`) && current.scrollHeight > current.clientHeight) {
          return current;
        }
        current = current.parentElement;
      }
      return window;
    }

    const handler = (event: MessageEvent) => {
      if (
        event.data?.type === 'passbar-html-resize'
        && event.data.ch === channelId
        && typeof event.data.height === 'number'
        && event.data.height > 0
      ) {
        setHeight(Math.ceil(event.data.height));
      }
      if (
        event.data?.type === 'passbar-choice-focus'
        && event.data.ch === channelId
        && typeof event.data.top === 'number'
      ) {
        const iframe = iframeRef.current;
        if (!iframe) return;
        const scroller = findScrollParent(iframe);
        const targetHeight = typeof event.data.height === 'number' ? event.data.height : 0;

        if (scroller === window) {
          const absoluteTop = iframe.getBoundingClientRect().top + window.scrollY + event.data.top;
          window.scrollTo({
            top: Math.max(0, absoluteTop - window.innerHeight * 0.28 + targetHeight * 0.2),
            behavior: 'smooth',
          });
        } else {
          const container = scroller as HTMLElement;
          const iframeRect = iframe.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const targetTop = container.scrollTop + (iframeRect.top - containerRect.top) + event.data.top;
          container.scrollTo({
            top: Math.max(0, targetTop - container.clientHeight * 0.28 + targetHeight * 0.2),
            behavior: 'smooth',
          });
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [channelId]);

  const postActiveChoice = React.useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'passbar-choice-hover',
      choice: activeChoiceKey ?? '',
    }, '*');
  }, [activeChoiceKey]);

  useEffect(() => {
    postActiveChoice();
  }, [postActiveChoice]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      srcDoc={srcDoc}
      className="block w-full border-0"
      style={{ height }}
      sandbox="allow-scripts allow-popups"
      scrolling="no"
      onLoad={postActiveChoice}
    />
  );
});

function ExplanationViewComponent({ question, userAnswer, selectedChoiceKey, correctChoiceKey, activeChoiceKey, display = defaultStudySettings.display, contentMode = 'english', textSize = 'medium' }: ExplanationViewProps) {
  const { t } = useI18n();

  // ── Determine what to show based on display flags ─────────────────────────
  // display.zhExplanation → show zh HTML; display.enExplanation → show en HTML
  // fallback to legacy contentMode if display flags aren't set
  const showZhHtml = display.zhExplanation ?? (contentMode === 'bilingual');
  const showEnHtml = display.enExplanation ?? (contentMode !== 'bilingual');
  const isChinese = showZhHtml && !showEnHtml;

  // Build list of HTML panels to show (can be both at once)
  const htmlPanels: Array<{ key: string; html: string; title: string }> = [];
  if (showEnHtml && question.enExplanationHtml) {
    htmlPanels.push({ key: 'en', html: question.enExplanationHtml, title: 'English explanation' });
  }
  if (showZhHtml && question.explanationHtml) {
    htmlPanels.push({ key: 'zh', html: question.explanationHtml, title: 'Chinese explanation' });
  }
  const htmlToShow = htmlPanels.length > 0 ? true : false;


  return (
    <div className="space-y-4">

      {/* HTML explanation panels — can show en, zh, or both; height auto-adjusts */}
      {htmlPanels.map(({ key, html, title }) => (
        <div key={key} className="text-slate-700">
          <HtmlPanel html={html} title={title} activeChoiceKey={activeChoiceKey} />
        </div>
      ))}

      {/* GeminiQuestionFeedback disabled — real-time Gemini calls replaced by pre-generated en-html/zh-html */}
    </div>
  );
}

export const ExplanationView = React.memo(ExplanationViewComponent);
