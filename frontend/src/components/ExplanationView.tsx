"use client";

import React, { useState, useEffect } from 'react';
import { generateQuestionExplanation, GenerateQuestionExplanationOutput } from '@/ai/flows/generate-question-explanation';
import { Question } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Brain, Image as ImageIcon, Sparkles } from 'lucide-react';
import Image from 'next/image';

interface ExplanationViewProps {
  question: Question;
  userAnswer: string;
}

export function ExplanationView({ question, userAnswer }: ExplanationViewProps) {
  const [loading, setLoading] = useState(true);
  const [explanation, setExplanation] = useState<GenerateQuestionExplanationOutput | null>(null);

  useEffect(() => {
    async function loadExplanation() {
      // If we have existing HTML explanation and it's not an AI test, use it
      if (question.explanationHtml && !question.apiMatchOk) {
        setExplanation({
          explanationText: '',
          explanationImage: question.sourceExplanationImageFile
        });
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const result = await generateQuestionExplanation({
          apiMatchOk: question.apiMatchOk,
          explainImgs: question.explainImgs,
          sourceExplanationImageFile: question.sourceExplanationImageFile,
          questionText: question.questionText,
          answerChoices: question.options,
          correctAnswer: question.correctAnswer,
          userAnswer: userAnswer,
        });
        setExplanation(result);
      } catch (error) {
        console.error("Failed to generate explanation:", error);
      } finally {
        setLoading(false);
      }
    }

    loadExplanation();
  }, [question, userAnswer]);

  if (loading) {
    return (
      <div className="space-y-4 p-6 bg-secondary/5 rounded-xl border border-secondary/20">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-secondary animate-pulse" />
          <p className="text-xs font-bold uppercase tracking-widest text-secondary">Generating AI Insight...</p>
        </div>
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-4 w-[85%]" />
        <Skeleton className="h-4 w-[95%]" />
        <Skeleton className="h-40 w-full mt-4" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-8 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-secondary/10 rounded-md">
            <Brain className="w-5 h-5 text-secondary" />
          </div>
          <h3 className="text-xl font-bold text-primary">Explanation</h3>
        </div>
        {question.apiMatchOk ? (
          <Badge className="bg-secondary text-white font-bold px-3 py-1 gap-1.5 border-none">
            <Sparkles className="w-3 h-3" />
            AI GENERATED
          </Badge>
        ) : (
          <Badge variant="outline" className="border-muted text-muted-foreground px-3 py-1 gap-1.5">
            <ImageIcon className="w-3 h-3" />
            VISUAL GUIDE
          </Badge>
        )}
      </div>

      <div className="prose prose-blue max-w-none text-muted-foreground leading-relaxed">
        {question.explanationHtml ? (
          <div 
            className="whitespace-normal" 
            dangerouslySetInnerHTML={{ __html: question.explanationHtml }} 
          />
        ) : (
          <div className="whitespace-pre-wrap">
            {explanation?.explanationText || (
              <p className="italic">Review the visual explanation below for this question.</p>
            )}
          </div>
        )}
      </div>

      {explanation?.explanationImage && (
        <div className="relative w-full aspect-video rounded-xl overflow-hidden shadow-lg border-2 border-muted bg-muted/20">
          <Image 
            src={explanation.explanationImage} 
            alt="Explanation visual aid" 
            fill 
            className="object-contain"
          />
        </div>
      )}

      {question.explainImgs.length > 0 && question.apiMatchOk && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {question.explainImgs.map((img, idx) => (
            <div key={idx} className="relative aspect-video rounded-lg overflow-hidden border shadow-sm group">
              <Image 
                src={img} 
                alt={`Explanation visual aid ${idx + 1}`} 
                fill 
                className="object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-white text-[10px] font-medium backdrop-blur-sm">
                Reference Image {idx + 1}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="p-4 rounded-lg bg-primary/5 border border-primary/10">
        <p className="text-xs font-bold text-primary mb-1 uppercase tracking-wider">Educational Objective</p>
        <p className="text-sm text-muted-foreground">
          Master the core concept of {question.topic} by understanding how it applies to legal scenarios.
        </p>
      </div>
    </div>
  );
}
