"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useRouter, useSearchParams } from 'next/navigation';
import { TestHeader } from '@/components/TestHeader';
import { TestFooter } from '@/components/TestFooter';
import { ExplanationView } from '@/components/ExplanationView';
import { RichText, ChoiceText, ChoiceState } from '@/components/RichText';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/components/AuthProvider';
import { Question, QuestionHighlight, TestSession } from '@/lib/types';
import { getQuestionsByIds } from '@/lib/question-bank';
import {
  getMarkedQuestionIds,
  getQuestionAnswerStats,
  saveOmittedQuestionProgress,
  saveQuestionAnswerProgress,
  setQuestionMarked,
} from '@/lib/question-progress';
import { deletePracticeSessionRecord, getPracticeSessionRecord, savePracticeAnswer, updatePracticeSessionRecord } from '@/lib/practice-sessions';
import { getBrowseProgressByUser, upsertBrowseProgress } from '@/lib/topic-study-progress';
import { getBrowseMarkedQuestionIds, getBrowseQuestionStates, upsertBrowseQuestionState } from '@/lib/topic-study-question-states';
import {
  addPendingAnswerSync,
  getTestQuestionSnapshot,
  saveTestQuestionSnapshot,
  syncPendingAnswerProgress,
} from '@/lib/offline-cache';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizablePanels } from '@/components/ResizablePanels';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { requestGeminiFeedback } from '@/lib/gemini-feedback';
import { defaultStudySettings, getStudySettings, saveStudySettings, type ContentMode, type DisplayOptions, type TextSize } from '@/lib/study-settings';
import { saveUserStudySettings } from '@/lib/user-settings';
import { useI18n } from '@/lib/i18n';
import { Check, Clock3, ListChecks, X } from 'lucide-react';
import { ReportQuestionDialog } from '@/components/ReportQuestionDialog';

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

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

function getCachedSessionQuestions(questionIds: string[], cachedQuestions: Question[] | null) {
  if (!cachedQuestions?.length) return null;
  const byId = new Map(cachedQuestions.map((question) => [question.id, question]));
  const ordered = questionIds
    .map((questionId) => byId.get(questionId))
    .filter((question): question is Question => Boolean(question));
  return ordered.length === questionIds.length ? ordered : null;
}

function TestSessionContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const isReviewMode = searchParams.get('review') === '1';
  const startIndexParam = parseInt(searchParams.get('startIndex') ?? '0', 10) || 0;
  const router = useRouter();
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [session, setSession] = useState<TestSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(startIndexParam);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [contentMode, setContentMode] = useState<ContentMode>('english');
  const [display, setDisplay] = useState<DisplayOptions>(defaultStudySettings.display);
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [panelResetKey, setPanelResetKey] = useState(0);
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now());
  const [isPaused, setIsPaused] = useState(false);
  const [pauseStartedAt, setPauseStartedAt] = useState<number | null>(null);
  const [answerMetaByQuestion, setAnswerMetaByQuestion] = useState<Record<string, AnswerMeta>>({});
  const [reportOpen, setReportOpen] = useState(false);
  const [markedQuestionIds, setMarkedQuestionIds] = useState<Set<string>>(new Set());
  // Browse mode: tracks which question IDs have been viewed (loaded from DB + updated on navigate)
  const [viewedQuestionIds, setViewedQuestionIds] = useState<Set<string>>(new Set());
  const [eliminatedOptionsByQuestion, setEliminatedOptionsByQuestion] = useState<Record<string, Set<string>>>({});
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [pendingEndSession, setPendingEndSession] = useState<TestSession | null>(null);
  const [ending, setEnding] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [activeExplanationChoiceKey, setActiveExplanationChoiceKey] = useState<string | null>(null);

  useEffect(() => {
    const settings = getStudySettings();
    setContentMode(settings.contentMode);
    setDisplay(settings.display);
    setTextSize(settings.textSize);

    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<{ contentMode: ContentMode; display: DisplayOptions; textSize: TextSize }>).detail;
      if (next?.contentMode) setContentMode(next.contentMode);
      if (next?.display) setDisplay(next.display);
      if (next?.textSize) setTextSize(next.textSize);
    };

    window.addEventListener('passbar-study-settings-changed', handleSettingsChange);
    return () => window.removeEventListener('passbar-study-settings-changed', handleSettingsChange);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const sync = () => {
      void syncPendingAnswerProgress();
    };

    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [user?.id]);

  useEffect(() => {
    const loadSession = async () => {
      if (!id) {
        router.push('/dashboard');
        return;
      }

      const sessions: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || localStorage.getItem('uprep_sessions') || '[]');
      sessions.forEach((s) => { if ((s.mode as string) === 'Browse') s.mode = 'TopicStudy'; });
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

      const cachedQuestions = getCachedSessionQuestions(
        currentSession.questionIds,
        await getTestQuestionSnapshot(currentSession.id),
      );
      const sessionQuestions = cachedQuestions ?? await getQuestionsByIds(currentSession.questionIds);
      if (!cachedQuestions && sessionQuestions.length > 0) {
        await saveTestQuestionSnapshot(currentSession.id, sessionQuestions);
      }
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
        // Only keep questions that were actually answered
        const answeredQuestionIds = sessionQuestions
          .map((q) => q.id)
          .filter((id) => id in dbAnswers);
        hydratedSession = {
          ...currentSession,
          questionIds: answeredQuestionIds,
          questionCount: answeredQuestionIds.length,
          userAnswers: dbAnswers,
          status: 'Completed',
        };
      }

      setSession(hydratedSession);
      setQuestions(sessionQuestions);
      setQuestionStartedAt(Date.now());
      if (user?.id) {
        // Browse mode uses its own marks table; test modes use user_question_progress.is_marked
        const markedIds = hydratedSession.mode === 'TopicStudy'
          ? await getBrowseMarkedQuestionIds(user.id, hydratedSession.questionIds)
          : await getMarkedQuestionIds(user.id, hydratedSession.questionIds);
        setMarkedQuestionIds(markedIds);

        // Browse mode: load previously viewed question IDs from browse_progress + learned states
        if (hydratedSession.mode === 'TopicStudy') {
          const [progressRows, questionStates] = await Promise.all([
            getBrowseProgressByUser(user.id),
            getBrowseQuestionStates(user.id, hydratedSession.questionIds),
          ]);
          const chapterSet = new Set(hydratedSession.chapters ?? []);
          const viewedIds = new Set<string>();
          progressRows
            .filter((row) => chapterSet.has(row.chapter_id))
            .forEach((row) => {
              // Mark all questions up to and including lastQuestionIndex as viewed
              const lastIdx = row.last_question_index ?? -1;
              sessionQuestions.slice(0, lastIdx + 1).forEach((q) => viewedIds.add(q.id));
              // Also mark the specific lastQuestionId
              if (row.last_question_id) viewedIds.add(row.last_question_id);
            });
          // Also add questions that are marked as learned in browse_question_states
          questionStates.forEach((state, questionId) => {
            if (state.isLearned) viewedIds.add(questionId);
          });
          setViewedQuestionIds(viewedIds);
        }
      }

      if (sessionQuestions.length > 0) {
        const existingAnswer = hydratedSession.userAnswers[sessionQuestions[0].id];
        if (existingAnswer) setSelectedAnswer(existingAnswer);
        // In review mode always show answers/explanations regardless of whether this question was answered
        if (isReviewMode || hydratedSession.mode === 'TopicStudy') {
          setSubmitted(true);
          // Mark the starting question as viewed immediately
          if (hydratedSession.mode === 'TopicStudy') {
            setViewedQuestionIds((prev) => {
              const next = new Set(prev);
              next.add(sessionQuestions[startIndexParam]?.id ?? sessionQuestions[0].id);
              return next;
            });
          }
        }
        else if (existingAnswer && hydratedSession.mode === 'Tutor') setSubmitted(true);
      }
    };

    loadSession();
  }, [id, isReviewMode, router, user?.id]);

  const currentQuestion = questions[currentIndex];
  const enQuestionText = currentQuestion?.questionText ?? '';
  const zhQuestionText = currentQuestion?.zhQuestionText || currentQuestion?.bilingualQuestionText || '';
  const enOptions = currentQuestion?.options ?? [];
  const zhOptionsArr = currentQuestion?.zhOptions?.length
    ? currentQuestion.zhOptions
    : (currentQuestion?.bilingualOptions ?? []);

  // Primary display text (for stats/review refs) — prefer zh if only zh is on
  const displayQuestionText = display.zhQA && !display.enQA
    ? (zhQuestionText || enQuestionText)
    : enQuestionText;
  // Primary options list — used for RadioGroup value matching
  const displayOptions = display.zhQA && !display.enQA
    ? (zhOptionsArr.length ? zhOptionsArr : enOptions)
    : enOptions;
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
  const showExplanation = Boolean(session?.mode === 'TopicStudy' || (submitted && (session?.mode === 'Tutor' || isReviewMode)));
  const showSubmitBtn = Boolean(session?.mode === 'Tutor' && !isPaused && !submitted && selectedAnswer);
  const currentAnswerMeta = currentQuestion ? answerMetaByQuestion[currentQuestion.id] : undefined;
  const currentEliminatedOptions = currentQuestion ? (eliminatedOptionsByQuestion[currentQuestion.id] || new Set<string>()) : new Set<string>();
  const questionTextHighlights = useMemo<QuestionHighlight[]>(() => {
    if (!currentQuestion) return [];
    const phraseHighlights = currentQuestion.questionHighlightMeta?.highlights ?? [];
    const keywordHighlights: QuestionHighlight[] = (currentQuestion.questionKeywordMeta?.keywords ?? []).map((keyword) => ({
      id: keyword.id ? `keyword-${keyword.id}` : `keyword-${keyword.text}`,
      text: keyword.text,
      kind: keyword.kind === 'fact_trigger' ? 'fact_trigger' : keyword.kind === 'procedural_posture' ? 'rule_trigger' : 'keyword',
      label: keyword.label,
      reason: keyword.reason,
      importance: keyword.importance,
    }));
    return [...phraseHighlights, ...keywordHighlights];
  }, [currentQuestion]);

  const persistAnswerProgress = useCallback(async (question: Question, answer: string, nextSession?: TestSession, elapsedSeconds?: number) => {
    if (!user?.id) return;
    const selectedChoice = getAnswerChoiceKey(question, answer);
    const correctChoice = (question.apiAnswerKey ?? question.correctAnswerLetter)?.toUpperCase();
    if (!selectedChoice || !correctChoice) return;
    const isCorrect = selectedChoice === correctChoice;

    const progressSaved = await saveQuestionAnswerProgress({
      userId: user.id,
      questionId: question.id,
      selectedChoice,
      correctAnswer: correctChoice,
      isCorrect,
      timeSpentSeconds: elapsedSeconds,
    });

    if (nextSession) {
      const answerSaved = await savePracticeAnswer({
        sessionId: nextSession.id,
        userId: user.id,
        questionId: question.id,
        selectedChoice,
        correctAnswer: correctChoice,
        isCorrect,
        timeSpentSeconds: elapsedSeconds,
      });
      if (!progressSaved || !answerSaved) {
        await addPendingAnswerSync({
          sessionId: nextSession.id,
          userId: user.id,
          questionId: question.id,
          selectedChoice,
          correctAnswer: correctChoice,
          isCorrect,
          timeSpentSeconds: elapsedSeconds,
          progressSynced: progressSaved,
          answerSynced: answerSaved,
        });
      }
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
    if (isReviewMode || session?.mode === 'TopicStudy' || (submitted && session?.mode === 'Tutor')) return;
    setSelectedAnswer(answer);

    if ((session?.mode === 'Timed' || session?.mode === 'SimExam') && currentQuestion) {
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
    if (session.mode !== 'Tutor' && session.mode !== 'TopicStudy' && !isReviewMode) return;
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

    // In review mode skip confirmation and go straight back
    if (isReviewMode) {
      router.push('/review');
      return;
    }

    // Browse mode: skip confirmation dialog, just end immediately
    if (session.mode === 'TopicStudy') {
      void handleEnd();
      return;
    }

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

  const handleSaveAndExit = async () => {
    if (!session || !user?.id) { router.push('/review'); return; }
    const nextSession = pendingEndSession ?? sessionWithCurrentProgress();
    if (!nextSession) return;
    // Zero answers: nothing worth saving — delete and exit cleanly
    if (Object.keys(nextSession.userAnswers).length === 0) {
      await deletePracticeSessionRecord({ sessionId: nextSession.id, userId: user.id });
      const stored: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || '[]');
      localStorage.setItem('passbar_sessions', JSON.stringify(stored.filter((s) => s.id !== session.id)));
      setEndConfirmOpen(false);
      setPendingEndSession(null);
      router.push('/review');
      return;
    }
    nextSession.status = 'In-Progress';
    setSession(nextSession);
    persistSession(nextSession);
    await updatePracticeSessionRecord({
      session: nextSession,
      userId: user.id,
      status: 'in_progress',
    });
    setEndConfirmOpen(false);
    setPendingEndSession(null);
    router.push('/review');
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
      // Browse mode: only save progress if user actually navigated (currentIndex > 0 means they moved past the first question)
      if (session.mode === 'TopicStudy') {
        const stored: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || '[]');
        localStorage.setItem('passbar_sessions', JSON.stringify(stored.filter((s) => s.id !== session.id)));
        setEndConfirmOpen(false);
        setPendingEndSession(null);
        if (viewedQuestionIds.size > 0 || currentIndex > 0) {
          const lastQuestion = questions[currentIndex];
          const actuallyViewed = new Set(viewedQuestionIds);
          actuallyViewed.add(questions[currentIndex].id);
          const chapterIds = nextSession.chapters;
          await Promise.all(chapterIds.map((chapterId) => {
            const chapterQuestions = questions.filter((q) => q.chapterId === chapterId);
            const viewedCount = chapterQuestions.filter((q) => actuallyViewed.has(q.id)).length;
            return upsertBrowseProgress({
              userId: user.id!,
              chapterId,
              viewedCount: Math.max(viewedCount, 1),
              lastQuestionId: lastQuestion?.id ?? null,
              lastQuestionIndex: currentIndex,
            });
          }));
        }
        router.push('/footprint');
        return;
      }

      const answeredIds = new Set(Object.keys(nextSession.userAnswers));

      const cleanUpAndExit = async (redirectTo: string) => {
        await deletePracticeSessionRecord({ sessionId: nextSession.id, userId: user.id! });
        const stored: TestSession[] = JSON.parse(localStorage.getItem('passbar_sessions') || '[]');
        localStorage.setItem('passbar_sessions', JSON.stringify(stored.filter((s) => s.id !== session.id)));
        setEndConfirmOpen(false);
        setPendingEndSession(null);
        router.push(redirectTo);
      };

      // Zero answers: delete the session entirely — don't leave an empty record in history
      if (answeredIds.size === 0) {
        await cleanUpAndExit('/review');
        return;
      }

      if ((session.mode === 'Timed' || session.mode === 'SimExam') && !isReviewMode) {
        const answeredCount = answeredIds.size;
        if (answeredCount < questions.length) {
          window.alert(t('test.completeTimedBeforeReview', {
            answered: answeredCount,
            total: questions.length,
          }));
          setEndConfirmOpen(false);
          return;
        }
      }

      const isComplete = answeredIds.size >= nextSession.questionIds.length;
      const dbStatus = isComplete ? 'completed' : 'suspended';

      nextSession.status = isComplete ? 'Completed' : 'Suspended';
      setSession(nextSession);
      persistSession(nextSession);
      await persistSessionAnswers(nextSession);

      // Only mark questions as omitted if the user navigated away from them (index < currentIndex).
      // The current question was never "skipped" — the user is still on it.
      // Questions beyond currentIndex were never seen — leave them as Unused.
      const reachedIds = nextSession.questionIds.slice(0, currentIndex);
      const omittedIds = reachedIds.filter((questionId) => !answeredIds.has(questionId));
      await saveOmittedQuestionProgress({
        userId: user.id,
        questionIds: omittedIds,
      });
      await updatePracticeSessionRecord({
        session: nextSession,
        userId: user.id,
        status: dbStatus,
      });
      setEndConfirmOpen(false);
      setPendingEndSession(null);
      router.push((session.mode === 'Timed' || session.mode === 'SimExam') ? `/test?id=${session.id}&review=1` : '/review');
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

  const handleTimeUp = useCallback(async () => {
    if (!session || !user?.id) return;
    const nextSession = sessionWithCurrentProgress() ?? session;
    nextSession.status = 'Completed';
    setSession(nextSession);
    persistSession(nextSession);
    await persistSessionAnswers(nextSession);
    const answeredIds = new Set(Object.keys(nextSession.userAnswers));
    const reachedIds = nextSession.questionIds.slice(0, currentIndex);
    const omittedIds = reachedIds.filter((qId) => !answeredIds.has(qId));
    await saveOmittedQuestionProgress({ userId: user.id, questionIds: omittedIds });
    await updatePracticeSessionRecord({ session: nextSession, userId: user.id, status: 'completed' });
    router.push(`/test?id=${session.id}&review=1`);
  }, [session, user?.id, sessionWithCurrentProgress, persistSession, persistSessionAnswers, currentIndex, router]);

  const handleNavigate = (newIndex: number) => {
    if (isPaused) return;
    if (newIndex < 0 || newIndex >= questions.length || !session || !currentQuestion) return;

    let nextSession = session;
    if ((session.mode === 'Timed' || session.mode === 'SimExam') && selectedAnswer) {
      nextSession = { ...session };
      nextSession.userAnswers[currentQuestion.id] = selectedAnswer;
      setSession(nextSession);
      persistSession(nextSession);
    }

    // Browse mode: mark only current + new question as viewed in local state
    if (session.mode === 'TopicStudy') {
      setViewedQuestionIds((prev) => {
        const next = new Set(prev);
        next.add(questions[currentIndex].id);
        next.add(questions[newIndex].id);
        return next;
      });
    }

    // Browse mode: auto-save progress after viewing each question
    if (session.mode === 'TopicStudy' && user?.id) {
      // Use the actually-viewed set (plus the two questions involved in this navigation)
      const actuallyViewed = new Set(viewedQuestionIds);
      actuallyViewed.add(questions[currentIndex].id);
      actuallyViewed.add(questions[newIndex].id);
      void Promise.all(session.chapters.map((chapterId) => {
        const chapterQuestions = questions.filter((q) => q.chapterId === chapterId);
        const viewedCount = chapterQuestions.filter((q) => actuallyViewed.has(q.id)).length;
        return upsertBrowseProgress({
          userId: user.id!,
          chapterId,
          viewedCount: Math.max(viewedCount, 1),
          lastQuestionId: questions[newIndex]?.id ?? null,
          lastQuestionIndex: newIndex,
        });
      }));
      // Mark the question being left as learned
      const leavingQuestion = questions[currentIndex];
      if (leavingQuestion) {
        void upsertBrowseQuestionState({
          userId: user.id,
          questionId: leavingQuestion.id,
          chapterId: leavingQuestion.chapterId,
          isLearned: true,
        });
      }
    }

    setCurrentIndex(newIndex);
    setQuestionStartedAt(Date.now());
    const nextQuestionId = questions[newIndex].id;
    const nextAnswer = nextSession.userAnswers[nextQuestionId] || null;
    setSelectedAnswer(nextAnswer);
    // Review mode: always show answer/explanation; Browse: always; Tutor: only if answered
    setSubmitted(isReviewMode || nextSession.mode === 'TopicStudy' || (Boolean(nextAnswer) && nextSession.mode === 'Tutor'));
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

    // Browse mode writes to browse_question_states; other modes write to user_question_progress
    const ok = session?.mode === 'TopicStudy'
      ? await upsertBrowseQuestionState({ userId: user.id, questionId: currentQuestion.id, isMarked: nextMarked })
      : await setQuestionMarked({ userId: user.id, questionId: currentQuestion.id, isMarked: nextMarked });

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
    if (!currentQuestion || isReviewMode || session?.mode === 'TopicStudy' || (submitted && session?.mode === 'Tutor')) return;
    
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

  const handleFeedback = () => {
    if (isPaused || !currentQuestion) return;
    setReportOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!session || !currentQuestion || isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;

      const key = event.key.toLowerCase();
      const modalOpen = endConfirmOpen || reportOpen || Boolean(document.querySelector('[role="dialog"]'));

      if (modalOpen) return;

      if (key === 'escape' && shortcutHelpOpen) {
        event.preventDefault();
        setShortcutHelpOpen(false);
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        setShortcutHelpOpen((open) => !open);
        return;
      }

      if (key === 'arrowleft') {
        event.preventDefault();
        handleNavigate(currentIndex - 1);
        return;
      }

      if (key === 'arrowright') {
        event.preventDefault();
        handleNavigate(currentIndex + 1);
        return;
      }

      if (key === 'enter' && showSubmitBtn) {
        event.preventDefault();
        void handleSubmit();
        return;
      }

      if (key === 'm') {
        event.preventDefault();
        void handleToggleMark();
        return;
      }

      if (key === 'p' && !isReviewMode) {
        event.preventDefault();
        handleSuspend();
        return;
      }

      const choiceKey = /^[a-d]$/.test(key)
        ? key
        : /^[1-4]$/.test(key)
          ? String.fromCharCode(96 + Number(key))
          : null;

      if (choiceKey) {
        const optionIndex = choiceKey.charCodeAt(0) - 97;
        const nextAnswer = displayOptions[optionIndex];
        if (nextAnswer) {
          event.preventDefault();
          handleSelectAnswer(nextAnswer);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentIndex,
    currentQuestion,
    displayOptions,
    endConfirmOpen,
    isReviewMode,
    reportOpen,
    session,
    shortcutHelpOpen,
    showSubmitBtn,
  ]);

  if (!session || !currentQuestion) return null;

  return (
    <div className="flex h-screen flex-col bg-white">
      <TestHeader
        questionIndex={currentIndex}
        totalQuestions={questions.length}
        answeredQuestionIndexes={session.mode === 'TopicStudy'
          ? questions.map((question, index) => viewedQuestionIds.has(question.id) ? index : -1).filter((index) => index !== -1)
          : questions.map((question, index) => session.userAnswers[question.id] ? index : -1).filter((index) => index !== -1)
        }
        markedQuestionIndexes={questions
          .map((question, index) => markedQuestionIds.has(question.id) ? index : -1)
          .filter((index) => index !== -1)}
        timeSpent={session.timeSpent}
        onTimeUpdate={handleTimeUpdate}
        onQuestionSelect={handleNavigate}
        onToggleMark={handleToggleMark}
        isPaused={isPaused || isReviewMode}
        textSize={textSize}
        onTextSizeChange={(size) => {
          setTextSize(size);
          const updated = { ...getStudySettings(), textSize: size };
          saveStudySettings(updated);
          if (user?.id) saveUserStudySettings(user.id, updated);
        }}
        display={display}
        onDisplayChange={(next) => {
          setDisplay(next);
          const updated = { ...getStudySettings(), display: next };
          saveStudySettings(updated);
          if (user?.id) saveUserStudySettings(user.id, updated);
        }}
        onReset={() => {
          setPanelResetKey((k) => k + 1);
          const current = getStudySettings();
          const reset = { ...defaultStudySettings, interfaceLanguage: current.interfaceLanguage };
          saveStudySettings(reset);
          if (user?.id) saveUserStudySettings(user.id, reset);
        }}
        onFeedback={handleFeedback}
        isBrowse={session.mode === 'TopicStudy'}
        subject={currentQuestion?.subject}
        topic={currentQuestion?.topic}
        timeLimitSeconds={session.timeLimitSeconds}
        onTimeUp={session.mode === 'SimExam' && !isReviewMode ? handleTimeUp : undefined}
        shortcutHelpOpen={shortcutHelpOpen}
        onShortcutHelpOpenChange={setShortcutHelpOpen}
      />

      {/* Bottom padding: mobile footer = nav row (56px) + optional submit row (~60px) */}
      <main className={cn(
        "mt-14 flex-1 overflow-hidden",
        showSubmitBtn ? "mb-36 sm:mb-20" : "mb-20 sm:mb-20"
      )}>
        <ResizablePanels
          enabled={showExplanation}
          defaultLeftPct={50}
          minPx={300}
          className="h-full w-full"
          resetKey={panelResetKey}
          left={
            <div className="h-full overflow-y-auto overflow-x-hidden">
            <div className={cn(
              "space-y-8 py-8",
              showExplanation ? "px-6 lg:px-8" : "mx-auto w-full max-w-5xl px-6 lg:px-8"
            )}>
              {/* ── Mobile-only subject · chapter tag ─────────────────────── */}
              {(currentQuestion?.subject || currentQuestion?.topic) && (
                <div className="sm:hidden flex flex-wrap items-center gap-1.5 -mt-4 mb-0">
                  {currentQuestion.subject && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {currentQuestion.subject}
                    </span>
                  )}
                  {currentQuestion.topic && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                      {currentQuestion.topic}
                    </span>
                  )}
                </div>
              )}

              {/* ── Question text ── EN / ZH / both stacked ─────────────── */}
              <div className="space-y-3">
                {(display.enQA || (!display.enQA && !display.zhQA)) && (
                  <RichText
                    text={enQuestionText}
                    highlights={questionTextHighlights}
                    className={cn('text-left font-normal text-slate-900', questionTextClass)}
                  />
                )}
                {display.zhQA && zhQuestionText && (
                  <RichText
                    text={zhQuestionText}
                    className={cn('text-left font-normal text-slate-600', questionTextClass)}
                  />
                )}
              </div>

              <div className="space-y-6">
                <RadioGroup
                  value={selectedChoiceKey || ''}
                  onValueChange={(choiceKey) => {
                    const optionIndex = choiceKey.toUpperCase().charCodeAt(0) - 65;
                    const nextAnswer = displayOptions[optionIndex];
                    if (nextAnswer) handleSelectAnswer(nextAnswer);
                  }}
                  disabled={isReviewMode || session.mode === 'TopicStudy' || (submitted && session.mode === 'Tutor')}
                  className="space-y-2"
                >
                  {displayOptions.map((option, idx) => {
                    const label = String.fromCharCode(65 + idx);
                    const isCorrect = label === normalizedCorrectAnswerKey || option === correctAnswer;
                    const isSelected = selectedChoiceKey === label;
                    const isEliminated = currentEliminatedOptions.has(label);
                    const isRevealed = Boolean(session.mode === 'TopicStudy' || (submitted && (session.mode === 'Tutor' || isReviewMode)));

                    let percentageText = null;
                    const realChoicePercent = currentAnswerMeta?.choicePercents[label as 'A' | 'B' | 'C' | 'D'];
                    if (isRevealed && realChoicePercent != null) {
                      percentageText = `(${realChoicePercent}%)`;
                    } else if (isRevealed && isCorrect && currentAnswerMeta?.correctPercent != null) {
                      percentageText = `(${currentAnswerMeta.correctPercent}%)`;
                    }

	                    return (
	                      <div
	                        key={`${label}-${option}`}
	                        className={cn(
	                          "group flex w-full items-start gap-2 sm:gap-3 py-3 px-1 sm:px-2 rounded-lg transition-colors cursor-pointer",
	                          // Highlight background when revealed
	                          isRevealed && isCorrect
	                            ? "bg-green-50 border border-green-200 hover:bg-green-50"
	                            : isRevealed && isSelected && !isCorrect
	                              ? "bg-red-50 border border-red-200 hover:bg-red-50"
	                              : "hover:bg-slate-50 border border-transparent",
	                        )}
	                        onMouseEnter={() => { if (window.matchMedia("(pointer: fine)").matches) setActiveExplanationChoiceKey(label); }}
	                        onMouseLeave={() => { if (window.matchMedia("(pointer: fine)").matches) setActiveExplanationChoiceKey(null); }}
	                        onFocus={() => { if (window.matchMedia("(pointer: fine)").matches) setActiveExplanationChoiceKey(label); }}
	                        onBlur={() => { if (window.matchMedia("(pointer: fine)").matches) setActiveExplanationChoiceKey(null); }}
	                      >

                        {/* Desktop-only ✓/✗ gutter — same mt offset as radio to stay aligned */}
                        <div className={cn(
                          "hidden sm:flex w-6 shrink-0 items-center justify-center",
                          textSize === 'large' ? 'mt-[10px]' : 'mt-2',
                        )}>
                          {isRevealed && isCorrect && <Check className="h-5 w-5 text-green-500" strokeWidth={2.5} />}
                          {isRevealed && isSelected && !isCorrect && <X className="h-5 w-5 text-red-500" strokeWidth={2.5} />}
                        </div>

                        {/* Radio + result icon stacked vertically (mobile) / radio only (desktop) */}
                        {/* mt aligns radio to vertical centre of first text line:
                            medium: (leading-9 36px - h-5 20px) / 2 = 8px
                            large:  (leading-10 40px - h-5 20px) / 2 = 10px           */}
                        <div className={cn(
                          "flex w-6 shrink-0 flex-col items-center gap-1",
                          textSize === 'large' ? 'mt-[10px]' : 'mt-2',
                        )}>
                          <RadioGroupItem
                            value={label}
                            id={`option-${idx}`}
                            className="h-5 w-5 border-2 border-solid border-slate-300 text-slate-700 transition-colors group-hover:border-slate-400 data-[state=checked]:border-primary data-[state=checked]:text-primary"
                          />
                          {/* ✓/✗ below radio — mobile only */}
                          {isRevealed && isCorrect && (
                            <Check className="sm:hidden h-4 w-4 text-green-500" strokeWidth={3} />
                          )}
                          {isRevealed && isSelected && !isCorrect && (
                            <X className="sm:hidden h-4 w-4 text-red-500" strokeWidth={3} />
                          )}
                          {/* Spacer to keep alignment when no icon */}
                          {isRevealed && !isCorrect && !isSelected && (
                            <span className="sm:hidden h-4 w-4" />
                          )}
                        </div>

                        {/* Option Label (e.g. A.) */}
                        <div
                          className={cn(
                            "shrink-0 font-bold text-slate-900 cursor-pointer select-none",
                            optionTextClass,
                            isEliminated && !isSelected && "text-slate-400"
                          )}
                          onClick={(e) => {
                            if (!isRevealed) handleToggleEliminate(e, label);
                          }}
                        >
                          {label}.
                        </div>
                        
                        {/* Option Description — EN + optional ZH stacked; % below on mobile */}
                        <div
                          className={cn(
                            'flex-1 cursor-pointer text-left font-normal text-slate-900',
                            optionTextClass,
                            isEliminated && !isSelected && 'line-through text-slate-400',
                            isRevealed && isCorrect && 'font-medium no-underline'
                          )}
                          onClick={(e) => {
                            if (!isRevealed) handleToggleEliminate(e, label);
                          }}
                        >
                          {/* Text + % in one row on desktop, stacked on mobile */}
                          <span className="flex items-start justify-between gap-2">
                            <span className="flex-1">
                              {/* EN option text */}
                              {(display.enQA || (!display.enQA && !display.zhQA)) && (
                                <ChoiceText
                                  className="block"
                                  text={enOptions[idx]?.replace(/^\s*[A-D]\.\s*/i, '') ?? option.replace(/^\s*[A-D]\.\s*/i, '')}
                                  keywords={currentQuestion?.choiceKeywordMeta?.choices?.[label as 'A' | 'B' | 'C' | 'D']}
                                  state={
                                    isRevealed
                                      ? isCorrect
                                        ? 'correct'
                                        : isSelected
                                          ? 'wrong'
                                          : 'unselected'
                                      : 'neutral'
                                  }
                                />
                              )}
                              {/* ZH option text stacked below */}
                              {display.zhQA && zhOptionsArr[idx] && (
                                <span className={cn(
                                  'block text-slate-500',
                                  display.enQA && 'mt-0.5 text-[0.9em]'
                                )}>
                                  {zhOptionsArr[idx].replace(/^\s*[A-D]\.\s*/i, '')}
                                </span>
                              )}
                            </span>
                            {/* % — inline on desktop, hidden here shown below on mobile */}
                            {percentageText && (
                              <span className="hidden sm:block shrink-0 text-sm font-normal text-slate-500 mt-0.5">
                                {percentageText}
                              </span>
                            )}
                          </span>
                          {/* % below text on mobile only */}
                          {percentageText && (
                            <span className="sm:hidden mt-1 block text-sm font-normal text-slate-500">
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
            </div>
          }
          right={showExplanation ? (
            <div className="h-full overflow-y-auto overflow-x-hidden bg-white">
              <div className="px-4 py-4 lg:px-6">
                <ExplanationView
                    question={currentQuestion}
                    userAnswer={selectedAnswer!}
                    selectedChoiceKey={selectedChoiceKey}
                    correctChoiceKey={normalizedCorrectAnswerKey}
                    display={display}
	                    contentMode={contentMode}
	                    textSize={textSize}
	                    activeChoiceKey={activeExplanationChoiceKey}
	                  />
              </div>
            </div>
          ) : <div />}
        />
      </main>

      <TestFooter
        canGoBack={currentIndex > 0}
        canGoForward={currentIndex < questions.length - 1}
        onBack={() => handleNavigate(currentIndex - 1)}
        onForward={() => handleNavigate(currentIndex + 1)}
        onSuspend={handleSuspend}
        onEnd={handleEndRequest}
        onSubmit={handleSubmit}
        showSubmit={showSubmitBtn}
        isPaused={isPaused || isReviewMode}
        isReviewMode={isReviewMode}
      />

      {user?.id && currentQuestion && (
        <ReportQuestionDialog
          questionId={currentQuestion.id}
          userId={user.id}
          open={reportOpen}
          onOpenChange={setReportOpen}
        />
      )}

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
            <Button
              variant="outline"
              onClick={() => void handleSaveAndExit()}
              disabled={ending}
            >
              {t('test.saveDraft')}
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
