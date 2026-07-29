import { api, ApiError } from './api';
import { TestSession } from './types';
import { type StudyPaceMode, type StudySubjectMode } from './study-settings';

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Expected MBE pacing limit: 1.8 minutes per question (for slow-risk evaluation) */
export const SECONDS_PER_QUESTION = 108;

/** Average time needed per question during study, including reading the explanation and digesting (5 minutes) */
export const LEARNING_SECONDS_PER_QUESTION = 300;

export type TimeBasedQuotaEstimate = { estimate: number; min: number; max: number };

export type SubjectConfidenceInput = {
  name: string;
  correct: number;
  incorrect: number;
  total: number;
  averageSeconds?: number;
  riskyQuestionRatio?: number;
  masteredQuestionRatio?: number;
};

export type DailyQuotaPlan = {
  quota: number;
  newQuota: number;
  reviewQuota: number;
  triageMode: boolean;
  availableDays: number;
  learningDays: number;
  reviewDays: number;
  reviewReserveRatio: number;
  remainingQuestions: number;
  timeEstimate: TimeBasedQuotaEstimate | null;
  timeCapped: boolean;
};

const PACE_FOCUS_RATIO: Record<StudyPaceMode, number> = {
  leisure: 45 / 60,
  balanced: 50 / 60,
  intensive: 55 / 60,
};

/**
 * Estimates how many questions fit into a daily study-time budget, at
 * SECONDS_PER_QUESTION per question (answering + reading the explanation).
 * Returns a +/- range rather than a single "ideal" number, since real
 * pacing varies from question to question.
 */
export function getEffectiveStudyHours(dailyStudyHours: number, paceMode: StudyPaceMode = 'balanced') {
  if (!dailyStudyHours || dailyStudyHours <= 0) return 0;
  return dailyStudyHours * PACE_FOCUS_RATIO[paceMode];
}

export function estimateMaxQuotaFromHours(dailyStudyHours: number, paceMode: StudyPaceMode = 'balanced'): TimeBasedQuotaEstimate {
  if (!dailyStudyHours || dailyStudyHours <= 0) {
    return { estimate: 0, min: 0, max: 0 };
  }

  const totalSeconds = getEffectiveStudyHours(dailyStudyHours, paceMode) * 3600;
  const estimate = Math.max(1, Math.round(totalSeconds / LEARNING_SECONDS_PER_QUESTION));
  const variance = Math.max(1, Math.round(estimate * 0.15));

  return {
    estimate,
    min: Math.max(1, estimate - variance),
    max: estimate + variance,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Suggested confidence is derived from actual answer history instead of a
 * purely manual feeling: correct rate raises confidence, wrong rate lowers it,
 * and tiny samples are blended back toward neutral so 1 lucky answer does not
 * mark a subject as mastered.
 */
export function calculateSuggestedSubjectConfidence(subjects: SubjectConfidenceInput[]): Record<string, number> {
  const result: Record<string, number> = {};

  subjects.forEach((subject) => {
    const answered = Math.max(subject.total, subject.correct + subject.incorrect);
    if (answered <= 0) {
      result[subject.name] = 50;
      return;
    }

    const correctRate = subject.correct / answered;
    const wrongRate = subject.incorrect / answered;
    const rawConfidence = 50 + (correctRate - wrongRate) * 50;
    const sampleWeight = clamp(answered / 30, 0.15, 1);
    const timePenalty = (subject.averageSeconds ?? 0) > SECONDS_PER_QUESTION
      ? clamp(((subject.averageSeconds ?? 0) - SECONDS_PER_QUESTION) / SECONDS_PER_QUESTION, 0, 1) * 20
      : 0;
    const riskPenalty = clamp(subject.riskyQuestionRatio ?? 0, 0, 1) * 20;
    const masteryRatio = clamp(subject.masteredQuestionRatio ?? 0, 0, 1);
    const spacedMasteryAdjustment = answered > 0 ? (masteryRatio - 0.5) * 20 : 0;
    result[subject.name] = Math.round(clamp(
      50 + (rawConfidence - 50) * sampleWeight - timePenalty - riskPenalty + spacedMasteryAdjustment,
      0,
      100,
    ));
  });

  return result;
}

function reviewReserveRatio(dueReviewChapterCount: number) {
  // Even if nothing is due today, new questions need future spaced review.
  // Existing due chapters increase the reserve, capped so learning can continue.
  return clamp(0.2 + dueReviewChapterCount * 0.01, 0.2, 0.35);
}

function buildQuotaPlan(
  remainingQuestions: number,
  base: { quota: number; triageMode: boolean; availableDays: number },
  dailyStudyHours: number | undefined,
  dueReviewChapterCount: number,
  paceMode: StudyPaceMode,
): DailyQuotaPlan {
  const reserveRatio = (remainingQuestions > 0 || dueReviewChapterCount > 0) && base.availableDays > 0
    ? reviewReserveRatio(dueReviewChapterCount)
    : 0;
  const reviewDays = reserveRatio > 0 ? Math.max(1, Math.ceil(base.availableDays * reserveRatio)) : 0;
  const learningDays = reserveRatio > 0 ? Math.max(1, base.availableDays - reviewDays) : base.availableDays;
  const newQuota = remainingQuestions > 0 && learningDays > 0
    ? Math.ceil(remainingQuestions / learningDays)
    : base.quota;
  const plannedReviewQuota = reserveRatio > 0 && dueReviewChapterCount > 0
    ? newQuota > 0
      ? Math.max(1, Math.round(newQuota * reserveRatio))
      : Math.min(20, dueReviewChapterCount * 5)
    : 0;
  const plannedTotalQuota = newQuota + plannedReviewQuota;

  const timeEstimate = estimateMaxQuotaFromHours(dailyStudyHours ?? 0, paceMode);
  const hasTimeCap = timeEstimate.estimate > 0;
  const quota = hasTimeCap ? Math.min(plannedTotalQuota, timeEstimate.estimate) : plannedTotalQuota;
  const maxAllowedReview = Math.max(5, Math.round(quota * 0.35));
  const reviewQuota = Math.min(plannedReviewQuota, quota, maxAllowedReview);

  return {
    ...base,
    quota,
    newQuota: Math.max(0, quota - reviewQuota),
    reviewQuota,
    learningDays,
    reviewDays,
    reviewReserveRatio: reserveRatio,
    remainingQuestions,
    timeEstimate: hasTimeCap ? timeEstimate : null,
    timeCapped: hasTimeCap && quota < plannedTotalQuota,
  };
}

/**
 * Calculates the recommended daily question quota based on remaining questions,
 * the user's exam date, and their study schedule. If `dailyStudyHours` is
 * provided, the quota is also capped by how many questions realistically fit
 * into that time budget (SECONDS_PER_QUESTION per question).
 */
export function calculateDailyQuota(
  totalQuestions: number,
  practicedQuestions: number,
  examDateIso: string | null,
  studyDaysPerWeek: number[],
  triageWeeks: number,
  dailyStudyHours?: number,
  dueReviewChapterCount = 0,
  paceMode: StudyPaceMode = 'balanced',
) {
  const remainingQuestions = Math.max(0, totalQuestions - practicedQuestions);

  let base: { quota: number; triageMode: boolean; availableDays: number };

  if (!examDateIso) {
    base = { quota: 0, triageMode: false, availableDays: 0 };
  } else {
    const today = startOfLocalDay(new Date());
    const examDate = startOfLocalDay(new Date(examDateIso + 'T00:00:00'));

    if (examDate <= today) {
      // Exam has passed — everything remaining is overdue.
      base = { quota: remainingQuestions, triageMode: true, availableDays: 0 };
    } else {
      const daysUntilExam = Math.round((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const triageDays = triageWeeks * 7;

      if (daysUntilExam <= triageDays) {
        // Already in the triage (sprint) period
        const studyDaysLeft = countStudyDays(today, examDate, studyDaysPerWeek);
        const availableDays = Math.max(1, studyDaysLeft);
        base = { quota: remainingQuestions > 0 ? Math.ceil(remainingQuestions / availableDays) : 0, triageMode: true, availableDays };
      } else {
        // Normal mode: practice until triage period begins
        const endOfPracticePeriod = new Date(examDate);
        endOfPracticePeriod.setDate(endOfPracticePeriod.getDate() - triageDays);

        const studyDaysLeft = countStudyDays(today, endOfPracticePeriod, studyDaysPerWeek);
        const availableDays = Math.max(1, studyDaysLeft);
        base = { quota: remainingQuestions > 0 ? Math.ceil(remainingQuestions / availableDays) : 0, triageMode: false, availableDays };
      }
    }
  }

  return buildQuotaPlan(remainingQuestions, base, dailyStudyHours, dueReviewChapterCount, paceMode);
}

export type ChapterAttemptStats = {
  chapterId: string;
  chapterName: string;
  subject: string;
  attempts: number;
  correct: number;
  lastAttemptAt: string;
  totalAttempts: number;
  lastAccuracy: number | null;
  totalTimeSeconds?: number;
  timedAttempts?: number;
  questionCount?: number;
  dueQuestionCount?: number;
  riskyQuestionCount?: number;
  masteredQuestionCount?: number;
};

export type ChapterReviewInfo = ChapterAttemptStats & {
  accuracy: number;
  daysSinceLastAttempt: number;
  idealIntervalDays: number;
  averageSeconds: number;
  masteryRate: number;
};

export type QuestionAttemptSignal = {
  isCorrect: boolean;
  answeredAt: string;
  timeSpentSeconds?: number | null;
  confidence?: string | null;
};

export type QuestionMasteryAssessment = {
  mastered: boolean;
  due: boolean;
  intervalDays: number;
  daysSinceLastAttempt: number;
  reliableCorrectStreak: number;
  distinctReliableDays: number;
  averageSeconds: number;
  everIncorrect: boolean;
  slowRisk: boolean;
  guessRisk: boolean;
  priority: number;
};

const MASTERY_INTERVALS = [1, 1, 3, 7, 14, 30] as const;
const POSSIBLE_GUESS_SECONDS = 30;

function isLowConfidence(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['low', 'guess', 'guessed', 'unsure', 'uncertain', '不確定', '不确定', '猜'].some((token) => normalized.includes(token));
}

/**
 * A correct answer is not treated as mastery by itself. Reliable mastery
 * requires correct answers on at least three separate days, at a sustainable
 * MBE pace, without a low-confidence or likely-guess signal.
 */
export function assessQuestionMastery(
  attempts: QuestionAttemptSignal[],
  now = new Date(),
): QuestionMasteryAssessment {
  const ordered = attempts
    .filter((attempt) => Boolean(attempt.answeredAt))
    .slice()
    .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));

  if (ordered.length === 0) {
    return {
      mastered: false,
      due: false,
      intervalDays: 1,
      daysSinceLastAttempt: 0,
      reliableCorrectStreak: 0,
      distinctReliableDays: 0,
      averageSeconds: 0,
      everIncorrect: false,
      slowRisk: false,
      guessRisk: false,
      priority: 0,
    };
  }

  const timed = ordered.filter((attempt) => (attempt.timeSpentSeconds ?? 0) > 0);
  const averageSeconds = timed.length > 0
    ? timed.reduce((sum, attempt) => sum + (attempt.timeSpentSeconds ?? 0), 0) / timed.length
    : 0;
  const everIncorrect = ordered.some((attempt) => !attempt.isCorrect);
  const last = ordered[ordered.length - 1];
  const slowRisk = (last.timeSpentSeconds ?? 0) > SECONDS_PER_QUESTION || averageSeconds > SECONDS_PER_QUESTION;
  const guessRisk = isLowConfidence(last.confidence)
    || (last.isCorrect && (last.timeSpentSeconds ?? Number.POSITIVE_INFINITY) < POSSIBLE_GUESS_SECONDS);

  let reliableCorrectStreak = 0;
  const reliableDays = new Set<string>();
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const attempt = ordered[index];
    const seconds = attempt.timeSpentSeconds ?? 0;
    const reliable = attempt.isCorrect
      && !isLowConfidence(attempt.confidence)
      && (seconds <= 0 || (seconds >= POSSIBLE_GUESS_SECONDS && seconds <= SECONDS_PER_QUESTION));
    if (!reliable) break;
    reliableCorrectStreak += 1;
    reliableDays.add(startOfLocalDay(new Date(attempt.answeredAt)).toISOString().slice(0, 10));
  }

  const distinctReliableDays = reliableDays.size;
  // Repeating the same answer several times on one day does not advance the
  // spacing stage; only success on a new calendar day earns a longer interval.
  const stage = Math.min(distinctReliableDays, MASTERY_INTERVALS.length - 1);
  const intervalDays = MASTERY_INTERVALS[stage];
  const lastAttemptDay = startOfLocalDay(new Date(last.answeredAt));
  const daysSinceLastAttempt = Math.max(0, Math.floor(
    (startOfLocalDay(now).getTime() - lastAttemptDay.getTime()) / (1000 * 60 * 60 * 24),
  ));
  const mastered = reliableCorrectStreak >= 3
    && distinctReliableDays >= 3
    && !slowRisk
    && !guessRisk;
  const due = daysSinceLastAttempt >= intervalDays;
  const priority =
    (due ? 100 : 0)
    + (!last.isCorrect ? 80 : 0)
    + (everIncorrect ? 30 : 0)
    + (guessRisk ? 35 : 0)
    + (slowRisk ? 25 : 0)
    + Math.max(0, 3 - distinctReliableDays) * 10
    + Math.max(0, daysSinceLastAttempt - intervalDays);

  return {
    mastered,
    due,
    intervalDays,
    daysSinceLastAttempt,
    reliableCorrectStreak,
    distinctReliableDays,
    averageSeconds,
    everIncorrect,
    slowRisk,
    guessRisk,
    priority,
  };
}

export type PracticeAnswerChapterRow = {
  question_id: string;
  is_correct: boolean | null;
  time_spent_seconds: number | null;
  confidence?: string | null;
  answered_at: string | null;
  question_items?: {
    chapters?: {
      id?: string | null;
      chapter?: string | null;
      subject?: string | null;
    } | null;
  } | null;
};

export function computeChapterStats(chapterAnswerRows: PracticeAnswerChapterRow[]): ChapterAttemptStats[] {
  type ChapterStatsAccumulator = ChapterAttemptStats & {
    questionIds: Set<string>;
    attemptsByQuestion: Map<string, Array<{
      isCorrect: boolean;
      answeredAt: string;
      timeSpentSeconds: number | null;
      confidence: string | null;
    }>>;
  };
  const chapterStatsMap = new Map<string, ChapterStatsAccumulator>();
  chapterAnswerRows.forEach((answer) => {
    const chapter = answer.question_items?.chapters;
    if (!chapter?.id || !answer.answered_at || !answer.question_id) return;

    const existing = chapterStatsMap.get(chapter.id) ?? {
      chapterId: chapter.id,
      chapterName: chapter.chapter ?? chapter.id,
      subject: chapter.subject ?? 'Uncategorized',
      attempts: 0,
      correct: 0,
      lastAttemptAt: answer.answered_at,
      totalAttempts: 0,
      lastAccuracy: null,
      totalTimeSeconds: 0,
      timedAttempts: 0,
      questionIds: new Set<string>(),
      attemptsByQuestion: new Map(),
    };

    existing.attempts += 1;
    if (answer.is_correct) existing.correct += 1;
    existing.totalTimeSeconds = (existing.totalTimeSeconds ?? 0) + (answer.time_spent_seconds ?? 0);
    if ((answer.time_spent_seconds ?? 0) > 0) existing.timedAttempts = (existing.timedAttempts ?? 0) + 1;
    existing.questionIds.add(answer.question_id);
    if (answer.answered_at > existing.lastAttemptAt) existing.lastAttemptAt = answer.answered_at;
    const questionAttempts = existing.attemptsByQuestion.get(answer.question_id) ?? [];
    questionAttempts.push({
      isCorrect: Boolean(answer.is_correct),
      answeredAt: answer.answered_at,
      timeSpentSeconds: answer.time_spent_seconds,
      confidence: answer.confidence ?? null,
    });
    existing.attemptsByQuestion.set(answer.question_id, questionAttempts);

    chapterStatsMap.set(chapter.id, existing);
  });
  
  return Array.from(chapterStatsMap.values()).map((stat) => {
    const assessments = Array.from(stat.attemptsByQuestion.values()).map((attempts) => assessQuestionMastery(attempts));
    return {
      chapterId: stat.chapterId,
      chapterName: stat.chapterName,
      subject: stat.subject,
      attempts: stat.attempts,
      correct: stat.correct,
      lastAttemptAt: stat.lastAttemptAt,
      totalAttempts: stat.attempts,
      lastAccuracy: stat.attempts > 0 ? Math.round((stat.correct / stat.attempts) * 100) : null,
      totalTimeSeconds: stat.totalTimeSeconds,
      timedAttempts: stat.timedAttempts,
      questionCount: stat.questionIds.size,
      dueQuestionCount: assessments.filter((assessment) => assessment.due).length,
      riskyQuestionCount: assessments.filter((assessment) => (
        assessment.slowRisk
        || assessment.guessRisk
        || (assessment.everIncorrect && !assessment.mastered)
      )).length,
      masteredQuestionCount: assessments.filter((assessment) => assessment.mastered).length,
    };
  });
}

export async function fetchDueReviewChaptersForUser(_userId: string): Promise<ChapterReviewInfo[]> {
  try {
    return await api.get<ChapterReviewInfo[]>('/attempts/planner/due-reviews');
  } catch (err) {
    // Session expiry redirects through the shared API client; this expected
    // state is not an actionable planner failure and should not pollute console.
    if (err instanceof ApiError && err.status === 401) return [];
    console.warn('[PassBar] Failed to fetch due reviews:', err);
    return [];
  }
}

/**
 * Applies a simplified Ebbinghaus forgetting-curve schedule: chapters with low
 * accuracy are due for review sooner (every 1 day), medium-accuracy chapters
 * weekly, and well-mastered chapters monthly. Returns chapters that are
 * currently overdue, sorted by urgency (most overdue + weakest first).
 */
export function getDueReviewChapters(chapterStats: ChapterAttemptStats[]): ChapterReviewInfo[] {
  const today = startOfLocalDay(new Date()).getTime();

  const due: ChapterReviewInfo[] = [];
  for (const stat of chapterStats) {
    if (stat.attempts === 0 || !stat.lastAttemptAt) continue;

    const accuracy = Math.round((stat.correct / stat.attempts) * 100);
    const lastAttemptDay = startOfLocalDay(new Date(stat.lastAttemptAt)).getTime();
    const daysSinceLastAttempt = Math.round((today - lastAttemptDay) / (1000 * 60 * 60 * 24));
    const averageSeconds = (stat.timedAttempts ?? 0) > 0
      ? (stat.totalTimeSeconds ?? 0) / (stat.timedAttempts ?? 1)
      : 0;
    const masteryRate = (stat.questionCount ?? 0) > 0
      ? Math.round(((stat.masteredQuestionCount ?? 0) / (stat.questionCount ?? 1)) * 100)
      : 0;
    const hasDetailedAssessment = stat.dueQuestionCount !== undefined;
    const idealIntervalDays =
      (stat.riskyQuestionCount ?? 0) > 0 || averageSeconds > SECONDS_PER_QUESTION
        ? 1
        : masteryRate >= 80 ? 30 : masteryRate >= 50 ? 7 : accuracy < 50 ? 1 : 3;

    if ((hasDetailedAssessment && (stat.dueQuestionCount ?? 0) > 0)
      || (!hasDetailedAssessment && daysSinceLastAttempt >= idealIntervalDays)) {
      due.push({ ...stat, accuracy, daysSinceLastAttempt, idealIntervalDays, averageSeconds, masteryRate });
    }
  }

  return due.sort((a, b) => {
    const urgencyA = (a.dueQuestionCount ?? 1) * 2
      + (a.riskyQuestionCount ?? 0)
      + (a.daysSinceLastAttempt / a.idealIntervalDays) * (1.1 - a.masteryRate / 100);
    const urgencyB = (b.dueQuestionCount ?? 1) * 2
      + (b.riskyQuestionCount ?? 0)
      + (b.daysSinceLastAttempt / b.idealIntervalDays) * (1.1 - b.masteryRate / 100);
    return urgencyB - urgencyA;
  });
}

/**
 * Splits today's total quota into a "review" portion (for chapters that are
 * due per the forgetting-curve schedule) and a "new" portion.
 */
export function splitQuotaForReview(totalQuota: number, dueChapterCount: number, plannedReviewQuota?: number): { reviewQuota: number; newQuota: number } {
  if (totalQuota <= 0 || dueChapterCount === 0) {
    return { reviewQuota: 0, newQuota: totalQuota };
  }

  const desired = plannedReviewQuota ?? Math.max(3, Math.round(totalQuota * 0.3));
  const reviewQuota = Math.min(totalQuota, desired, dueChapterCount * 5);
  return { reviewQuota, newQuota: totalQuota - reviewQuota };
}

/**
 * Allocates today's quota across subjects, weighted by the user's confidence
 * level (0-100) in each subject. Lower confidence → more questions assigned.
 * Subjects with no confidence value default to 50 (medium).
 */
export function calculateSubjectQuotas(
  subjects: Array<{ name: string; remaining: number }>,
  totalQuota: number,
  confidence: Record<string, number>,
): Record<string, number> {
  const eligible = subjects.filter((s) => s.remaining > 0);
  if (eligible.length === 0 || totalQuota <= 0) return {};

  // Weight is inversely proportional to confidence; floor of 5 keeps even
  // high-confidence subjects in rotation.
  const weights = eligible.map((s) => Math.max(5, 100 - (confidence[s.name] ?? 50)));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  const result: Record<string, number> = {};
  let allocated = 0;
  eligible.forEach((s, i) => {
    const raw = Math.floor((weights[i] / totalWeight) * totalQuota);
    const capped = Math.min(raw, s.remaining);
    result[s.name] = capped;
    allocated += capped;
  });

  // Distribute any rounding leftover to subjects that still have headroom.
  let leftover = totalQuota - allocated;
  let guard = 0;
  while (leftover > 0 && guard < eligible.length * Math.max(1, leftover)) {
    const s = eligible[guard % eligible.length];
    if (result[s.name] < s.remaining) {
      result[s.name] += 1;
      leftover -= 1;
    }
    guard += 1;
  }

  return result;
}

function weightedSubjectOrder(
  subjects: Array<{ name: string; remaining: number }>,
  confidence: Record<string, number>,
  subjectOrder?: string[],
): Array<{ name: string; remaining: number }> {
  return subjects
    .filter((s) => s.remaining > 0)
    .sort((a, b) => {
      if (subjectOrder && subjectOrder.length > 0) {
        const indexA = subjectOrder.indexOf(a.name);
        const indexB = subjectOrder.indexOf(b.name);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
      }
      const weightA = Math.max(5, 100 - (confidence[a.name] ?? 50));
      const weightB = Math.max(5, 100 - (confidence[b.name] ?? 50));
      return weightB - weightA || a.name.localeCompare(b.name);
    });
}

export function getStudyDayIndexFromToday(date: Date, studyDaysPerWeek: number[]): number {
  const today = startOfLocalDay(new Date());
  const target = startOfLocalDay(date);
  let idx = 0;
  const cursor = new Date(today);
  while (cursor < target) {
    if (studyDaysPerWeek.includes(cursor.getDay())) idx += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return idx;
}

export function getFocusSubjectForDate(
  subjects: Array<{ name: string; remaining: number }>,
  confidence: Record<string, number>,
  studyDaysPerWeek: number[],
  date = new Date(),
  subjectOrder?: string[],
): string | null {
  const ordered = weightedSubjectOrder(subjects, confidence, subjectOrder);
  if (ordered.length === 0) return null;
  const idx = getStudyDayIndexFromToday(date, studyDaysPerWeek) % ordered.length;
  return ordered[idx].name;
}

export function calculatePlannedSubjectQuotas(
  subjects: Array<{ name: string; remaining: number }>,
  totalQuota: number,
  confidence: Record<string, number>,
  subjectMode: StudySubjectMode,
  isTriageMode: boolean,
  studyDaysPerWeek: number[],
  date = new Date(),
  subjectOrder?: string[],
): Record<string, number> {
  if (subjectMode === 'singleThenMixed' && !isTriageMode) {
    const focus = getFocusSubjectForDate(subjects, confidence, studyDaysPerWeek, date, subjectOrder);
    if (!focus) return {};
    const remaining = subjects.find((subject) => subject.name === focus)?.remaining ?? 0;
    return { [focus]: Math.min(totalQuota, remaining) };
  }

  return calculateSubjectQuotas(subjects, totalQuota, confidence);
}

export function getPlannedChapterIdsForDate(
  subjects: Array<{ name: string; chapters: Array<{ id: string; count: number }> }>,
  subjectQuotas: Record<string, number>,
  subjectMode: StudySubjectMode,
  isTriageMode: boolean,
  studyDaysPerWeek: number[],
  date = new Date(),
): string[] {
  const activeSubjects = subjects
    .filter((subject) => (subjectQuotas[subject.name] ?? 0) > 0)
    .sort((a, b) => (subjectQuotas[b.name] ?? 0) - (subjectQuotas[a.name] ?? 0));
  const mixed = subjectMode === 'mixed' || isTriageMode;
  const selectedSubjects = mixed ? activeSubjects.slice(0, 3) : activeSubjects.slice(0, 1);
  const studyDayIndex = getStudyDayIndexFromToday(date, studyDaysPerWeek);

  return selectedSubjects.flatMap((subject) => {
    const chapters = subject.chapters.filter((chapter) => chapter.count > 0);
    if (chapters.length === 0) return [];
    const start = studyDayIndex % chapters.length;
    const count = mixed ? 1 : Math.min(2, chapters.length);
    return Array.from({ length: count }, (_, offset) => chapters[(start + offset) % chapters.length].id);
  });
}

/**
 * Helper to count how many study days exist between start and end date (exclusive of end, inclusive of start)
 */
function countStudyDays(start: Date, end: Date, studyDaysPerWeek: number[]): number {
  const allowedSet = new Set(studyDaysPerWeek);
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    if (allowedSet.has(cursor.getDay())) {
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Generates a practice session tailored for today's mission.
 * The backend owns question selection and review-history evaluation; this is
 * a thin wrapper over the planner API.
 */
export async function generateTodayMissionSession(
  _userId: string,
  targetQuota: number,
  _isTriageMode: boolean,
  subjectQuotas?: Record<string, number>,
  reviewChapterIds?: string[],
  reviewQuota?: number,
  preferredNewChapterIds?: string[],
): Promise<{ session: TestSession; orderedQuestions: any[] } | null> {
  if (targetQuota <= 0) return null;
  try {
    return await api.post('/attempts/planner/generate-mission-session', {
      targetQuota,
      subjectQuotas,
      reviewChapterIds,
      reviewQuota,
      preferredNewChapterIds,
    });
  } catch (err) {
    console.warn('[PassBar] Failed to generate mission session:', err);
    return null;
  }
}

/**
 * Generates a practice session from previously incorrectly answered questions.
 */
export async function generateIncorrectSession(
  _userId: string,
  targetQuota: number,
): Promise<{ session: TestSession; orderedQuestions: any[] } | null> {
  if (targetQuota <= 0) return null;
  try {
    return await api.post('/attempts/planner/generate-incorrect-session', { targetQuota });
  } catch (err) {
    console.warn('[PassBar] Failed to generate incorrect session:', err);
    return null;
  }
}

export type TodayMissionChapter = { id: string; name: string; subject: string };

/**
 * Standalone version of the dashboard daily-mission computation.
 * Returns today's new-practice chapters + due review chapters for a given user.
 */
export async function fetchTodayMissionForUser(_userId: string): Promise<{
  newChapters: TodayMissionChapter[];
  reviewChapters: ChapterReviewInfo[];
}> {
  try {
    return await api.get('/attempts/planner/today-mission');
  } catch (err) {
    console.warn('[PassBar] Failed to fetch today mission:', err);
    return { newChapters: [], reviewChapters: [] };
  }
}
