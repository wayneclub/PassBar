"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TestHeader } from '@/components/TestHeader';
import { TestFooter } from '@/components/TestFooter';
import { ExplanationView } from '@/components/ExplanationView';
import { Question, TestSession } from '@/lib/types';
import { getQuestionsByIds } from '@/lib/question-bank';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

export default function TestSessionPage() {
  const { id } = useParams();
  const router = useRouter();
  const [session, setSession] = useState<TestSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);

  useEffect(() => {
    const loadSession = async () => {
    const sessions: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
    const currentSession = sessions.find(s => s.id === id);
    
    if (!currentSession) {
      router.push('/dashboard');
      return;
    }

    setSession(currentSession);
    
    const sessionQuestions = await getQuestionsByIds(currentSession.questionIds);

    setQuestions(sessionQuestions);
    
    // Resume progress if exists for the first question
    if (sessionQuestions.length > 0) {
      const existingAnswer = currentSession.userAnswers[sessionQuestions[0].id];
      if (existingAnswer) {
        setSelectedAnswer(existingAnswer);
        if (currentSession.mode === 'Tutor') setSubmitted(true);
      }
    }
    };

    loadSession();
  }, [id, router]);

  const currentQuestion = questions[currentIndex];

  const handleTimeUpdate = useCallback((newTime: number) => {
    // Ideally update storage periodically or on suspend
  }, []);

  const handleSelectAnswer = (answer: string) => {
    if (submitted && session?.mode === 'Tutor') return;
    setSelectedAnswer(answer);
  };

  const handleSubmit = () => {
    if (!selectedAnswer) return;
    setSubmitted(true);
    
    // Save to session
    if (session) {
      const updatedSession = { ...session };
      updatedSession.userAnswers[currentQuestion.id] = selectedAnswer;
      setSession(updatedSession);
      
      const sessions: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
      const index = sessions.findIndex(s => s.id === id);
      if (index !== -1) {
        sessions[index] = updatedSession;
        localStorage.setItem('passbar_sessions', JSON.stringify(sessions));
      }
    }
  };

  const handleNavigate = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= questions.length) return;
    
    // Save current state if timed mode (automatically submit basically)
    if (session?.mode === 'Timed' && selectedAnswer) {
      const updatedSession = { ...session };
      updatedSession.userAnswers[currentQuestion.id] = selectedAnswer;
      setSession(updatedSession);
      const sessions: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
      const idx = sessions.findIndex(s => s.id === id);
      if (idx !== -1) {
        sessions[idx] = updatedSession;
        localStorage.setItem('passbar_sessions', JSON.stringify(sessions));
      }
    }

    setCurrentIndex(newIndex);
    const nextQId = questions[newIndex].id;
    const nextAnswer = session?.userAnswers[nextQId] || null;
    setSelectedAnswer(nextAnswer);
    setSubmitted(!!nextAnswer && session?.mode === 'Tutor');
  };

  if (!session || !currentQuestion) return null;

  return (
    <div className="flex flex-col h-screen bg-white">
      <TestHeader 
        questionIndex={currentIndex} 
        totalQuestions={questions.length} 
        timeSpent={session.timeSpent}
        onTimeUpdate={handleTimeUpdate}
        isPaused={false}
      />

      <main className="flex-1 mt-14 mb-16 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
            {/* Question Text */}
            <div className="text-[17px] leading-relaxed font-normal text-slate-800 whitespace-pre-wrap">
              {currentQuestion.questionText}
            </div>

            {/* Options */}
            <div className="space-y-6">
              <RadioGroup 
                value={selectedAnswer || ""} 
                onValueChange={handleSelectAnswer}
                disabled={submitted && session.mode === 'Tutor'}
              >
                {currentQuestion.options.map((option, idx) => {
                  const label = String.fromCharCode(65 + idx);
                  const isCorrect = option === currentQuestion.correctAnswer;
                  const isSelected = selectedAnswer === option;
                  
                  return (
                    <div key={idx} className="flex items-start gap-4 group">
                      <RadioGroupItem 
                        value={option} 
                        id={`option-${idx}`}
                        className="mt-1 border-slate-400 text-slate-700 h-5 w-5"
                      />
                      <Label 
                        htmlFor={`option-${idx}`}
                        className={cn(
                          "text-[16px] leading-snug cursor-pointer font-normal flex-1",
                          submitted && session.mode === 'Tutor' && isCorrect && "text-green-600 font-semibold",
                          submitted && session.mode === 'Tutor' && isSelected && !isCorrect && "text-red-600"
                        )}
                      >
                        <span className="font-bold mr-2">{label}.</span>
                        {option}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>

              {!submitted && (
                <div className="pt-4">
                  <Button 
                    className="bg-[#2c3e50] hover:bg-[#34495e] text-white px-8 py-2 h-auto text-sm font-semibold rounded-full shadow-sm"
                    onClick={handleSubmit}
                    disabled={!selectedAnswer}
                  >
                    Submit
                  </Button>
                </div>
              )}
            </div>

            {submitted && session.mode === 'Tutor' && (
              <ExplanationView question={currentQuestion} userAnswer={selectedAnswer!} />
            )}
          </div>
        </ScrollArea>
      </main>

      <TestFooter 
        canGoBack={currentIndex > 0}
        canGoForward={currentIndex < questions.length - 1}
        onBack={() => handleNavigate(currentIndex - 1)}
        onForward={() => handleNavigate(currentIndex + 1)}
        onSuspend={() => router.push('/dashboard')}
        onEnd={() => router.push('/review')}
        onSubmit={handleSubmit}
        showSubmit={!submitted && !!selectedAnswer}
        isTutorMode={session.mode === 'Tutor'}
      />
    </div>
  );
}
