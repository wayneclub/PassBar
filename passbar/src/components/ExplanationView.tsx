"use client";

import React, { PointerEvent, useEffect, useRef, useState } from 'react';
import { ExplanationOcrWord, Question } from '@/lib/types';
import { Eraser, Highlighter, Image as ImageIcon, RotateCcw, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import type { ContentMode, TextSize } from '@/lib/study-settings';
import { requestGeminiQuestionAnalysis } from '@/lib/gemini-feedback';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface ExplanationViewProps {
  question: Question;
  userAnswer: string;
  selectedChoiceKey?: string | null;
  correctChoiceKey?: string | null;
  contentMode?: ContentMode;
  textSize?: TextSize;
}

type Point = {
  x: number;
  y: number;
};

type HighlightStroke = {
  points: Point[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function OcrTextLayer({ words }: { words: ExplanationOcrWord[] }) {
  if (words.length === 0) return null;

  return (
    <div className="absolute inset-0 z-10 select-text text-transparent [text-shadow:none]">
      {words.map((word, index) => (
        <span
          key={`${word.text}-${index}`}
          className="absolute block overflow-visible whitespace-nowrap leading-none selection:bg-yellow-200/80 selection:text-slate-950"
          style={{
            left: `${word.bbox.x * 100}%`,
            top: `${word.bbox.y * 100}%`,
            width: `${word.bbox.width * 100}%`,
            height: `${word.bbox.height * 100}%`,
            fontSize: `${Math.max(word.bbox.height * 100, 1.2)}cqw`,
          }}
        >
          {word.text}
        </span>
      ))}
    </div>
  );
}

function ExplanationImageViewer({
  src,
  index,
  ocrWords,
}: {
  src: string;
  index: number;
  ocrWords: ExplanationOcrWord[];
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [highlighting, setHighlighting] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokes, setStrokes] = useState<HighlightStroke[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const imageWrap = imageWrapRef.current;
    if (!canvas || !imageWrap) return;

    const render = () => {
      const rect = imageWrap.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(ratio, ratio);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = 18;
      context.strokeStyle = 'rgba(250, 204, 21, 0.38)';
      context.globalCompositeOperation = 'multiply';

      strokes.forEach((stroke) => {
        if (stroke.points.length < 2) return;
        context.beginPath();
        context.moveTo(stroke.points[0].x * rect.width, stroke.points[0].y * rect.height);
        stroke.points.slice(1).forEach((point) => {
          context.lineTo(point.x * rect.width, point.y * rect.height);
        });
        context.stroke();
      });
    };

    render();
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(imageWrap);
    return () => resizeObserver.disconnect();
  }, [strokes, zoom]);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!highlighting) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDrawing(true);
    setStrokes((current) => [...current, { points: [point] }]);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!highlighting || !isDrawing) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setStrokes((current) => current.map((stroke, strokeIndex) => (
      strokeIndex === current.length - 1
        ? { points: [...stroke.points, point] }
        : stroke
    )));
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  return (
    <div className="rounded-md border bg-white shadow-sm">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-1 text-xs font-semibold text-slate-600">
          <ImageIcon className="h-4 w-4 text-primary" />
          {t('explanation.image', { index: index + 1 })}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoom((value) => clamp(value - 0.15, 0.65, 2.5))}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs font-semibold tabular-nums text-slate-600">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoom((value) => clamp(value + 0.15, 0.65, 2.5))}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={highlighting ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setHighlighting((value) => !value)}
          >
            <Highlighter className="h-4 w-4" />
            {t('explanation.highlight')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setStrokes([])}
            aria-label="Clear highlights"
          >
            <Eraser className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="max-h-[calc(100vh-12rem)] overflow-auto bg-slate-50 p-3">
        <div
          ref={imageWrapRef}
          className="relative mx-auto origin-top rounded-sm bg-white shadow-sm [container-type:inline-size]"
          style={{ width: `${zoom * 100}%`, minWidth: zoom > 1 ? `${zoom * 100}%` : undefined }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`Explanation visual aid ${index + 1}`}
            className="block h-auto w-full select-none"
            draggable={false}
          />
          <OcrTextLayer words={ocrWords} />
          <canvas
            ref={canvasRef}
            className={cn(
              'absolute inset-0 z-20 h-full w-full',
              highlighting ? 'cursor-crosshair touch-none' : 'pointer-events-none',
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            onPointerLeave={stopDrawing}
          />
        </div>
      </div>
    </div>
  );
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
  const { language } = useI18n();
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function loadFeedback() {
      try {
        setLoading(true);
        setError(null);
        
        const options = question.options.map((text, idx) => ({
          key: String.fromCharCode(65 + idx),
          text
        }));

        const result = await requestGeminiQuestionAnalysis({
          questionText: question.questionText,
          options,
          selectedChoice: selectedChoiceKey,
          correctChoice: correctChoiceKey,
          explanationText: question.explanationHtml || '', // Using html or other available text
          topic: question.topic,
          interfaceLanguage: language
        });
        
        if (isMounted) {
          setFeedback(result);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load AI feedback');
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
    medium: 'text-[16px] leading-7',
    large: 'text-[18px] leading-8',
  }[textSize || 'medium'];

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-5">
      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm font-bold uppercase tracking-wider text-primary">Gemini AI Analysis</p>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-primary/70" />}
      </div>
      
      {loading && !feedback && (
        <div className={cn('text-muted-foreground animate-pulse', textClass)}>
          Analyzing question and your answer...
        </div>
      )}
      
      {error && !feedback && (
        <div className={cn('text-red-500', textClass)}>
          {error}
        </div>
      )}
      
      {feedback && (
        <div className={cn('whitespace-pre-wrap text-slate-800', textClass)}>
          {feedback}
        </div>
      )}
    </div>
  );
}

export function ExplanationView({ question, userAnswer, selectedChoiceKey, correctChoiceKey, contentMode = 'english', textSize = 'medium' }: ExplanationViewProps) {
  const { t } = useI18n();
  const englishImages = [
    question.sourceExplanationImageUrl,
    ...question.explainImgs,
  ].filter((src, index, list): src is string => Boolean(src) && list.indexOf(src) === index);
  const bilingualImages = [
    ...englishImages,
    ...(question.zhExplainImgs ?? []),
  ].filter((src, index, list): src is string => Boolean(src) && list.indexOf(src) === index);
  const explanationImages = contentMode === 'bilingual' ? bilingualImages : englishImages;
  const bilingualHtml = contentMode === 'bilingual' ? question.explanationHtml : undefined;
  const ocrByUrl = new Map((question.explanationOcr ?? []).map((ocr) => [ocr.publicUrl, ocr.words]));
  const helperTextClass = {
    medium: 'text-lg leading-8',
    large: 'text-xl leading-9',
  }[textSize];
  const objectiveTextClass = {
    medium: 'text-lg leading-8',
    large: 'text-xl leading-9',
  }[textSize];

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-top-4 duration-500">
      {bilingualHtml && (
        <div className="text-slate-700">
          <iframe
            title="Bilingual explanation"
            srcDoc={bilingualHtml}
            className={cn(
              'w-full rounded-md border bg-white',
              textSize === 'medium' && 'h-[760px]',
              textSize === 'large' && 'h-[860px]',
            )}
            sandbox=""
          />
        </div>
      )}

      {explanationImages.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {explanationImages.map((img, idx) => (
            <ExplanationImageViewer key={img} src={img} index={idx} ocrWords={ocrByUrl.get(img) ?? []} />
          ))}
        </div>
      )}

      <GeminiQuestionFeedback
        question={question}
        selectedChoiceKey={selectedChoiceKey}
        correctChoiceKey={correctChoiceKey}
        textSize={textSize}
      />
    </div>
  );
}
