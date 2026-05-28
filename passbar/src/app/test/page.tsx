"use client";

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useRouter, useSearchParams } from 'next/navigation';
import { TestHeader } from '@/components/TestHeader';
import { TestFooter } from '@/components/TestFooter';
import { ExplanationView } from '@/components/ExplanationView';
import { RichText } from '@/components/RichText';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/components/AuthProvider';
import { Question, TestSession } from '@/lib/types';
import { getQuestionsByIds } from '@/lib/question-bank';
import {
  getMarkedQuestionIds,
  getQuestionAnswerStats,
  saveOmittedQuestionProgress,
  saveQuestionAnswerProgress,
  setQuestionMarked,
} from '@/lib/question-progress';
import { getPracticeSessionRecord, savePracticeAnswer, updatePracticeSessionRecord } from '@/lib/practice-sessions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { requestGeminiFeedback } from '@/lib/gemini-feedback';
import { getStudySettings, type ContentMode, type TextSize } from '@/lib/study-settings';
import { useI18n } from '@/lib/i18n';
import { Check, Clock3, ListChecks, X } from 'lucide-react';

type AnswerMeta = {
  elapsedSeconds: number;
  correctPercent: number | null;
  choicePercents: Partial<Record<'A' | 'B' | 'C' | 'D', number>>;
};

function formatAnswerTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes.toString().padStart(2, '0')} min, ${remainingSeconds.toString().padStart(2, '0')} secs`;
  }
  return `${remainingSeconds.toString().padStart(2, '0')} secs`;
}

function getAnswerFromChoiceKey(question: Question, choiceKey: string | null | undefined) {
  if (!choiceKey) return null;
  const index = choiceKey.toUpperCase().charCodeAt(0) - 65;
  if (index < 0) return null;
  return question.options[index] ?? question.bilingualOptions?.[index] ?? null;
}

function TestSessionContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const isReviewMode = searchParams.get('review') === '1';
  const router = useRouter();
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [session, setSession] = useState<TestSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [contentMode, setContentMode] = useState<ContentMode>('english');
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now());
  const [isPaused, setIsPaused] = useState(false);
  const [pauseStartedAt, setPauseStartedAt] = useState<number | null>(null);
  const [answerMetaByQuestion, setAnswerMetaByQuestion] = useState<Record<string, AnswerMeta>>({});
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [markedQuestionIds, setMarkedQuestionIds] = useState<Set<string>>(new Set());
  const [eliminatedOptionsByQuestion, setEliminatedOptionsByQuestion] = useState<Record<string, Set<string>>>({});
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [pendingEndSession, setPendingEndSession] = useState<TestSession | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const settings = getStudySettings();
    setContentMode(settings.contentMode);
    setTextSize(settings.textSize);

    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<{ contentMode: ContentMode; textSize: TextSize }>).detail;
      if (next?.contentMode) setContentMode(next.contentMode);
      if (next?.textSize) setTextSize(next.textSize);
    };

    window.addEventListener('passbar-study-settings-changed', handleSettingsChange);
    return () => window.removeEventListener('passbar-study-settings-changed', handleSettingsChange);
  }, []);

  useEffect(() => {
    const loadSession = async () => {
      if (!id) {
        router.push('/dashboard');
        return;
      }

      const sessions: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
      let currentSession = isReviewMode ? null : sessions.find((item) => item.id === id) ?? null;

      if (!currentSession) {
        if (!user?.id) return;
        currentSession = await getPracticeSessionRecord(id, user.id, { answeredOnly: isReviewMode });
        if (!currentSession && isReviewMode) {
          currentSession = sessions.find((item) => item.id === id) ?? null;
        }
        if (!currentSession) {
          router.push('/dashboard');
          return;
        }
      }

      const sessionQuestions = await getQuestionsByIds(currentSession.questionIds);
      let hydratedSession = currentSession;
      if (isReviewMode) {
        const dbAnswers = Object.fromEntries(
          sessionQuestions
            .map((question) => {
              const answer = currentSession.userAnswers[question.id]
                ?? getAnswerFromChoiceKey(question, currentSession.userAnswerChoices?.[question.id]);
              return answer ? [question.id, answer] : null;
            })
            .filter((entry): entry is [string, string] => Boolean(entry)),
        );
        hydratedSession = {
          ...currentSession,
          questionIds: sessionQuestions.map((question) => question.id),
          questionCount: sessionQuestions.length,
          userAnswers: dbAnswers,
          status: 'Completed',
        };
      }

      setSession(hydratedSession);
      setQuestions(sessionQuestions);
      setQuestionStartedAt(Date.now());
      if (user?.id) {
        const markedIds = await getMarkedQuestionIds(user.id, hydratedSession.questionIds);
        setMarkedQuestionIds(markedIds);
      }

      if (sessionQuestions.length > 0) {
        const existingAnswer = hydratedSession.userAnswers[sessionQuestions[0].id];
        if (existingAnswer) {
          setSelectedAnswer(existingAnswer);
          if (hydratedSession.mode === 'Tutor' || hydratedSession.mode === 'Browse' || isReviewMode) setSubmitted(true);
        }
        if (hydratedSession.mode === 'Browse') setSubmitted(true);
      }
    };

    loadSession();
  }, [id, isReviewMode, router, user?.id]);

  const currentQuestion = questions[currentIndex];
  const displayQuestionText = contentMode === 'bilingual' && currentQuestion?.bilingualQuestionText
    ? currentQuestion.bilingualQuestionText
    : currentQuestion?.questionText;
  const displayOptions = contentMode === 'bilingual' && currentQuestion?.bilingualOptions?.length
    ? currentQuestion.bilingualOptions
    : currentQuestion?.options ?? [];
  const correctAnswerKey = currentQuestion?.apiAnswerKey ?? currentQuestion?.correctAnswerLetter;
  const correctAnswer = displayOptions.find((option, index) => {
    const key = String.fromCharCode(65 + index);
    return key === correctAnswerKey || option === currentQuestion?.correctAnswer;
  }) ?? currentQuestion?.correctAnswer;
  const questionTextClass = {
    medium: 'text-[19px] leading-9',
    large: 'text-[22px] leading-10',
  }[textSize];
  const optionTextClass = {
    medium: 'text-[18px] leading-8',
    large: 'text-[20px] leading-9',
  }[textSize];
  const getAnswerChoiceKey = useCallback((question: Question, answer: string) => {
    const candidates = [question.options, question.bilingualOptions ?? []];
    for (const options of candidates) {
      const index = options.findIndex((option) => option === answer);
      if (index !== -1) return String.fromCharCode(65 + index);
    }
    const prefixedKey = answer.match(/^\s*([A-D])\./i)?.[1]?.toUpperCase();
    return prefixedKey ?? null;
  }, []);
  const selectedChoiceKey = currentQuestion && selectedAnswer ? getAnswerChoiceKey(currentQuestion, selectedAnswer) : null;
  const normalizedCorrectAnswerKey = correctAnswerKey?.toUpperCase() ?? null;
  const isSubmittedCorrect = Boolean(submitted && selectedChoiceKey && normalizedCorrectAnswerKey && selectedChoiceKey === normalizedCorrectAnswerKey);
  const showExplanation = Boolean(session?.mode === 'Browse' || (submitted && (session?.mode === 'Tutor' || isReviewMode)));
  const currentAnswerMeta = currentQuestion ? answerMetaByQuestion[currentQuestion.id] : undefined;
  const currentEliminatedOptions = currentQuestion ? (eliminatedOptionsByQuestion[currentQuestion.id] || new Set<string>()) : new Set<string>();

  const persistAnswerProgress = useCallback(async (question: Question, answer: string, nextSession?: TestSession, elapsedSeconds?: number) => {
    if (!user?.id) return;
    const selectedChoice = getAnswerChoiceKey(question, answer);
    const correctChoice = (question.apiAnswerKey ?? question.correctAnswerLetter)?.toUpperCase();
    if (!selectedChoice || !correctChoice) return;
    const isCorrect = selectedChoice === correctChoice;

    await saveQuestionAnswerProgress({
      userId: user.id,
      questionId: question.id,
      selectedChoice,
      correctAnswer: correctChoice,
      isCorrect,
      timeSpentSeconds: elapsedSeconds,
    });

    if (nextSession) {
      await savePracticeAnswer({
        sessionId: nextSession.id,
        userId: user.id,
        questionId: question.id,
        selectedChoice,
        correctAnswer: correctChoice,
        isCorrect,
        timeSpentSeconds: elapsedSeconds,
      });
    }
  }, [getAnswerChoiceKey, user?.id]);

  const persistSessionAnswers = useCallback(async (nextSession: TestSession) => {
    await Promise.all(Object.entries(nextSession.userAnswers).map(([questionId, answer]) => {
      const question = questions.find((item) => item.id === questionId);
      return question ? persistAnswerProgress(question, answer, nextSession) : Promise.resolve();
    }));
  }, [persistAnswerProgress, questions]);

  useEffect(() => {
    if (!submitted || !currentQuestion || currentAnswerMeta) return;

    getQuestionAnswerStats(currentQuestion.id).then((stats) => {
      setAnswerMetaByQuestion((prev) => {
        if (prev[currentQuestion.id]) return prev;
        return {
          ...prev,
          [currentQuestion.id]: {
            elapsedSeconds: 0,
            correctPercent: stats.correctPercent,
            choicePercents: stats.choicePercents,
          },
        };
      });
    });
  }, [currentAnswerMeta, currentQuestion, submitted]);

  const handleTimeUpdate = useCallback((newTime: number) => {
    setSession((prev) => prev ? { ...prev, timeSpent: newTime } : prev);
  }, []);

  const persistSession = useCallback((updatedSession: TestSession) => {
    const sessions: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
    const index = sessions.findIndex((item) => item.id === id);
    if (index !== -1) {
      sessions[index] = updatedSession;
      localStorage.setItem('passbar_sessions', JSON.stringify(sessions));
    }
  }, [id]);

  const sessionWithCurrentProgress = useCallback(() => {
    if (!session) return null;
    const nextSession = {
      ...session,
      userAnswers: { ...session.userAnswers },
    };
    if (selectedAnswer && currentQuestion) {
      nextSession.userAnswers[currentQuestion.id] = selectedAnswer;
    }
    return nextSession;
  }, [currentQuestion, selectedAnswer, session]);

  const handleSelectAnswer = (answer: string) => {
    if (isPaused) return;
    if (isReviewMode || session?.mode === 'Browse' || (submitted && session?.mode === 'Tutor')) return;
    setSelectedAnswer(answer);

    if (session?.mode === 'Timed' && currentQuestion) {
      const nextSession = {
        ...session,
        userAnswers: {
          ...session.userAnswers,
          [currentQuestion.id]: answer,
        },
      };
      setSession(nextSession);
      persistSession(nextSession);
    }
  };

  const handleSubmit = async () => {
    if (isPaused) return;
    if (!selectedAnswer || !session || !currentQuestion) return;
    if (session.mode !== 'Tutor' && session.mode !== 'Browse' && !isReviewMode) return;
    setSubmitted(true);

    const updatedSession = { ...session };
    updatedSession.userAnswers[currentQuestion.id] = selectedAnswer;
    setSession(updatedSession);
    persistSession(updatedSession);
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000));
    await persistAnswerProgress(currentQuestion, selectedAnswer, updatedSession, elapsedSeconds);
    const stats = await getQuestionAnswerStats(currentQuestion.id);
    setAnswerMetaByQuestion((prev) => ({
      ...prev,
      [currentQuestion.id]: {
        elapsedSeconds,
        correctPercent: stats.correctPercent,
        choicePercents: stats.choicePercents,
      },
    }));
  };

  const handleEndRequest = () => {
    if (!session) return;

    const nextSession = sessionWithCurrentProgress();
    if (!nextSession) return;

    setPendingEndSession(nextSession);
    setEndConfirmOpen(true);
    setSession(nextSession);
    persistSession(nextSession);

    if (!isReviewMode && user?.id) {
      void updatePracticeSessionRecord({
        session: nextSession,
        userId: user.id,
        status: nextSession.status === 'Suspended' ? 'suspended' : 'in_progress',
      });
    }
  };

  const handleEnd = async () => {
    if (!session || !user?.id || ending) {
      if (!session || !user?.id) router.push('/review');
      return;
    }

    const nextSession = pendingEndSession ?? sessionWithCurrentProgress();
    if (!nextSession) return;
    setEnding(true);

    try {
      if (session.mode === 'Timed' && !isReviewMode) {
        const answeredCount = Object.keys(nextSession.userAnswers).length;
        if (answeredCount < questions.length) {
          window.alert(t('test.completeTimedBeforeReview', {
            answered: answeredCount,
            total: questions.length,
          }));
          setEndConfirmOpen(false);
          return;
        }
      }

      nextSession.status = 'Completed';
      setSession(nextSession);
      persistSession(nextSession);
      await persistSessionAnswers(nextSession);

      const answeredIds = new Set(Object.keys(nextSession.userAnswers));
      await saveOmittedQuestionProgress({
        userId: user.id,
        questionIds: nextSession.questionIds.filter((questionId) => !answeredIds.has(questionId)),
      });
      await updatePracticeSessionRecord({
        session: nextSession,
        userId: user.id,
        status: 'completed',
      });
      setEndConfirmOpen(false);
      setPendingEndSession(null);
      router.push(session.mode === 'Timed' ? `/test?id=${session.id}&review=1` : '/review');
    } finally {
      setEnding(false);
    }
  };

  const handleSuspend = () => {
    if (!session) return;

    if (!isPaused) {
      setIsPaused(true);
      setPauseStartedAt(Date.now());
      return;
    }

    if (pauseStartedAt) {
      const pausedForMs = Date.now() - pauseStartedAt;
      setQuestionStartedAt((startedAt) => startedAt + pausedForMs);
    }
    setPauseStartedAt(null);
    setIsPaused(false);
  };

  const handleNavigate = (newIndex: number) => {
    if (isPaused) return;
    if (newIndex < 0 || newIndex >= questions.length || !session || !currentQuestion) return;

    let nextSession = session;
    if (session.mode === 'Timed' && selectedAnswer) {
      nextSession = { ...session };
      nextSession.userAnswers[currentQuestion.id] = selectedAnswer;
      setSession(nextSession);
      persistSession(nextSession);
    }

    setCurrentIndex(newIndex);
    setQuestionStartedAt(Date.now());
    const nextQuestionId = questions[newIndex].id;
    const nextAnswer = nextSession.userAnswers[nextQuestionId] || null;
    setSelectedAnswer(nextAnswer);
    setSubmitted(nextSession.mode === 'Browse' || (Boolean(nextAnswer) && (nextSession.mode === 'Tutor' || isReviewMode)));
  };

  const handleToggleMark = async () => {
    if (!user?.id || !currentQuestion) return;
    const nextMarked = !markedQuestionIds.has(currentQuestion.id);
    setMarkedQuestionIds((current) => {
      const next = new Set(current);
      if (nextMarked) next.add(currentQuestion.id);
      else next.delete(currentQuestion.id);
      return next;
    });

    const ok = await setQuestionMarked({
      userId: user.id,
      questionId: currentQuestion.id,
      isMarked: nextMarked,
    });

    if (!ok) {
      setMarkedQuestionIds((current) => {
        const next = new Set(current);
        if (nextMarked) next.delete(currentQuestion.id);
        else next.add(currentQuestion.id);
        return next;
      });
    }
  };

  const handleToggleEliminate = (e: React.MouseEvent, label: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentQuestion || isReviewMode || session?.mode === 'Browse' || (submitted && session?.mode === 'Tutor')) return;
    
    setEliminatedOptionsByQuestion((prev) => {
      const currentSet = prev[currentQuestion.id] || new Set();
      const newSet = new Set(currentSet);
      if (newSet.has(label)) {
        newSet.delete(label);
      } else {
        newSet.add(label);
      }
      return { ...prev, [currentQuestion.id]: newSet };
    });
  };

  const handleFeedback = async () => {
    if (isPaused) return;
    if (!session) return;
    const answeredEntries = Object.entries(session.userAnswers);
    if (answeredEntries.length === 0) {
      setFeedbackText(t('test.feedbackEmpty'));
      setFeedbackError(null);
      setFeedbackOpen(true);
      return;
    }

    setFeedbackOpen(true);
    setFeedbackLoading(true);
    setFeedbackError(null);

    try {
      const attempts = answeredEntries.map(([questionId, answer]) => {
        const question = questions.find((item) => item.id === questionId);
        const selectedChoice = question ? getAnswerChoiceKey(question, answer) : null;
        const correctChoice = (question?.apiAnswerKey ?? question?.correctAnswerLetter)?.toUpperCase() ?? null;
        return {
          subject: question?.subject,
          topic: question?.topic,
          questionText: question?.questionText,
          selectedChoice,
          correctChoice,
          isCorrect: Boolean(selectedChoice && correctChoice && selectedChoice === correctChoice),
          timeSpentSeconds: answerMetaByQuestion[questionId]?.elapsedSeconds ?? null,
        };
      });

      const feedback = await requestGeminiFeedback({
        mode: session.mode,
        totalQuestions: questions.length,
        attempts,
        unansweredCount: Math.max(questions.length - answeredEntries.length, 0),
        interfaceLanguage: language,
      });
      setFeedbackText(feedback);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : t('test.feedbackError'));
    } finally {
      setFeedbackLoading(false);
    }
  };

  if (!session || !currentQuestion) return null;

  return (
    <div className="flex h-screen flex-col bg-white">
      <TestHeader
        questionIndex={currentIndex}
        totalQuestions={questions.length}
        answeredQuestionIndexes={questions
          .map((question, index) => session.userAnswers[question.id] ? index : -1)
          .filter((index) => index !== -1)}
        markedQuestionIndexes={questions
          .map((question, index) => markedQuestionIds.has(question.id) ? index : -1)
          .filter((index) => index !== -1)}
        timeSpent={session.timeSpent}
        onTimeUpdate={handleTimeUpdate}
        onQuestionSelect={handleNavigate}
        onToggleMark={handleToggleMark}
        isPaused={isPaused}
        contentMode={contentMode}
        onToggleContentMode={() => setContentMode((prev) => prev === 'bilingual' ? 'english' : 'bilingual')}
      />

      <main className="mb-16 mt-14 flex-1 overflow-hidden">
        <div className={cn(
          "grid h-full w-full",
          showExplanation
            ? "grid-cols-1 lg:grid-cols-[minmax(420px,1fr)_minmax(420px,1.06fr)] xl:grid-cols-[minmax(380px,2fr)_minmax(480px,3fr)] 2xl:grid-cols-[minmax(360px,1fr)_minmax(560px,2fr)]"
            : ""
        )}>
          <ScrollArea className={cn("h-full w-full", showExplanation && "border-r border-slate-200")}>
            <div className={cn(
              "space-y-8 py-8",
              showExplanation ? "px-6 lg:px-8" : "mx-auto w-full max-w-5xl px-6 lg:px-8"
            )}>
              <RichText
                text={displayQuestionText ?? ''}
                className={cn('text-left font-normal text-slate-900', questionTextClass)}
              />

              <div className="space-y-6">
                <RadioGroup
                  value={selectedChoiceKey || ''}
                  onValueChange={(choiceKey) => {
                    const optionIndex = choiceKey.toUpperCase().charCodeAt(0) - 65;
                    const nextAnswer = displayOptions[optionIndex];
                    if (nextAnswer) handleSelectAnswer(nextAnswer);
                  }}
                  disabled={isReviewMode || session.mode === 'Browse' || (submitted && session.mode === 'Tutor')}
                  className="space-y-2"
                >
                  {displayOptions.map((option, idx) => {
                    const label = String.fromCharCode(65 + idx);
                    const isCorrect = label === normalizedCorrectAnswerKey || option === correctAnswer;
                    const isSelected = selectedChoiceKey === label;
                    const isEliminated = currentEliminatedOptions.has(label);
                    const isRevealed = Boolean(session.mode === 'Browse' || (submitted && (session.mode === 'Tutor' || isReviewMode)));

                    let percentageText = null;
                    const realChoicePercent = currentAnswerMeta?.choicePercents[label as 'A' | 'B' | 'C' | 'D'];
                    if (isRevealed && realChoicePercent != null) {
                      percentageText = `(${realChoicePercent}%)`;
                    } else if (isRevealed && isCorrect && currentAnswerMeta?.correctPercent != null) {
                      percentageText = `(${currentAnswerMeta.correctPercent}%)`;
                    }

                    return (
                      <div key={`${label}-${option}`} className="group flex w-full items-start gap-3 py-3 px-2 rounded-lg transition-colors hover:bg-slate-50 cursor-pointer">
                        
                        {/* Gutter for correct/incorrect icons */}
                        <div className={cn("flex w-6 shrink-0 items-center justify-center", optionTextClass)}>
                          <span className="invisible w-0">&#8203;</span>
                          {isRevealed && isCorrect && <Check className="h-5 w-5 text-green-500" strokeWidth={2.5} />}
                          {isRevealed && isSelected && !isCorrect && <X className="h-5 w-5 text-red-500" strokeWidth={2.5} />}
                        </div>

                        {/* Radio Button */}
                        <div className={cn("flex shrink-0 items-center", optionTextClass)}>
                          <span className="invisible w-0">&#8203;</span>
                          <RadioGroupItem
                            value={label}
                            id={`option-${idx}`}
                            className="h-5 w-5 border-2 border-solid border-slate-300 text-slate-700 transition-colors group-hover:border-slate-400 data-[state=checked]:border-primary data-[state=checked]:text-primary"
                          />
                        </div>

                        {/* Option Label (e.g. A.) - Not struck through */}
                        <div 
                          className={cn(
                            "shrink-0 font-bold text-slate-900 cursor-pointer select-none",
                            optionTextClass,
                            isEliminated && !isSelected && "text-slate-400"
                          )}
                          onClick={(e) => {
                            if (!isRevealed) {
                              handleToggleEliminate(e, label);
                            }
                          }}
                        >
                          {label}.
                        </div>
                        
                        {/* Option Description - Struck through when eliminated */}
                        <div 
                          className={cn(
                            'flex-1 cursor-pointer text-left font-normal text-slate-900 flex items-start justify-between',
                            optionTextClass,
                            isEliminated && !isSelected && 'line-through text-slate-400',
                            isRevealed && isCorrect && 'font-medium no-underline'
                          )}
                          onClick={(e) => {
                            if (!isRevealed) {
                              handleToggleEliminate(e, label);
                            }
                          }}
                        >
                          <span className="flex-1 pr-4">
                            {option.replace(/^\s*[A-D]\.\s*/i, '')}
                          </span>
                          
                          {percentageText && (
                            <span className="shrink-0 font-normal text-slate-900 ml-4">
                              {percentageText}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </RadioGroup>

                {submitted && selectedChoiceKey && normalizedCorrectAnswerKey ? (
                  <div
                    className={cn(
                      'mt-8 grid gap-5 border bg-white p-5 shadow-sm md:grid-cols-[1fr_1fr_1fr]',
                      isSubmittedCorrect ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-500',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'mt-0.5 flex h-5 w-5 items-center justify-center',
                        isSubmittedCorrect ? 'text-green-600' : 'text-red-600',
                      )}>
                        {isSubmittedCorrect ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className={cn('text-sm font-semibold', isSubmittedCorrect ? 'text-green-700' : 'text-red-600')}>
                          {isSubmittedCorrect ? t('test.correct') : t('test.incorrect')}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-600">
                          {t('test.correctAnswer')}
                          <div className="text-sm font-semibold text-slate-900">{normalizedCorrectAnswerKey}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <ListChecks className="h-7 w-7 text-slate-500" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {currentAnswerMeta?.correctPercent ?? '--'}%
                        </div>
                        <div className="text-xs text-slate-600">{t('test.answeredCorrectly')}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Clock3 className="h-8 w-8 text-slate-500" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {currentAnswerMeta?.elapsedSeconds ? formatAnswerTime(currentAnswerMeta.elapsedSeconds) : '--'}
                        </div>
                        <div className="text-xs text-slate-600">{t('test.timeSpent')}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </ScrollArea>

          {showExplanation && (
            <ScrollArea className="h-full bg-white">
              <div className="px-6 py-6 lg:px-10 xl:px-14 2xl:px-16">
                <div className="border-t border-slate-200 pt-5">
                  <ExplanationView
                    question={currentQuestion}
                    userAnswer={selectedAnswer!}
                    selectedChoiceKey={selectedChoiceKey}
                    correctChoiceKey={normalizedCorrectAnswerKey}
                    contentMode={contentMode}
                    textSize={textSize}
                  />
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </main>

      <TestFooter
        canGoBack={currentIndex > 0}
        canGoForward={currentIndex < questions.length - 1}
        onBack={() => handleNavigate(currentIndex - 1)}
        onForward={() => handleNavigate(currentIndex + 1)}
        onSuspend={handleSuspend}
        onEnd={handleEndRequest}
        onSubmit={handleSubmit}
        onFeedback={handleFeedback}
        showSubmit={session.mode === 'Tutor' && !isPaused && !submitted && Boolean(selectedAnswer)}
        feedbackLoading={feedbackLoading}
        isPaused={isPaused}
        isTutorMode={session.mode === 'Tutor'}
      />

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-h-[82vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('test.aiFeedback')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4">
            {feedbackLoading ? (
              <p className="text-sm text-slate-600">{t('test.generatingFeedback')}</p>
            ) : feedbackError ? (
              <div className="space-y-2">
                <p className="font-semibold text-red-600">{t('test.feedbackError')}</p>
                <p className="whitespace-pre-wrap text-sm text-red-500">{feedbackError}</p>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none leading-7 text-slate-800">
                <ReactMarkdown>{feedbackText || ''}</ReactMarkdown>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setFeedbackOpen(false)}>
              {t('test.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={endConfirmOpen} onOpenChange={(open) => {
        if (ending) return;
        setEndConfirmOpen(open);
        if (!open) setPendingEndSession(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('test.confirmEndTitle')}</DialogTitle>
            <DialogDescription>
              {t('test.confirmEndDescription', {
                answered: Object.keys((pendingEndSession ?? session).userAnswers).length,
                total: questions.length,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setEndConfirmOpen(false);
                setPendingEndSession(null);
              }}
              disabled={ending}
            >
              {t('test.cancelEnd')}
            </Button>
            <Button onClick={handleEnd} disabled={ending}>
              {ending ? t('test.ending') : t('test.confirmEnd')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TestSessionPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-white" />}>
        <TestSessionContent />
      </Suspense>
    </AuthGuard>
  );
}
