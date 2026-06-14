import { getSubjects, getAllQuestionIdsByChapter, getQuestionsByChapterIds } from './question-bank';
import { getAllUserProgress, QuestionStatusFilter } from './question-progress';
import { createPracticeSessionRecord } from './practice-sessions';
import { TestSession } from './types';

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Average seconds needed per question, including reading the explanation afterwards. */
export const SECONDS_PER_QUESTION = 108;

export type TimeBasedQuotaEstimate = { estimate: number; min: number; max: number };

/**
 * Estimates how many questions fit into a daily study-time budget, at
 * SECONDS_PER_QUESTION per question (answering + reading the explanation).
 * Returns a +/- range rather than a single "ideal" number, since real
 * pacing varies from question to question.
 */
export function estimateMaxQuotaFromHours(dailyStudyHours: number): TimeBasedQuotaEstimate {
  if (!dailyStudyHours || dailyStudyHours <= 0) {
    return { estimate: 0, min: 0, max: 0 };
  }

  const totalSeconds = dailyStudyHours * 3600;
  const estimate = Math.max(1, Math.round(totalSeconds / SECONDS_PER_QUESTION));
  const variance = Math.max(1, Math.round(estimate * 0.15));

  return {
    estimate,
    min: Math.max(1, estimate - variance),
    max: estimate + variance,
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
) {
  const remainingQuestions = Math.max(0, totalQuestions - practicedQuestions);

  let base: { quota: number; triageMode: boolean; availableDays: number };

  if (!examDateIso || remainingQuestions === 0) {
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
        base = { quota: Math.ceil(remainingQuestions / availableDays), triageMode: true, availableDays };
      } else {
        // Normal mode: practice until triage period begins
        const endOfPracticePeriod = new Date(examDate);
        endOfPracticePeriod.setDate(endOfPracticePeriod.getDate() - triageDays);

        const studyDaysLeft = countStudyDays(today, endOfPracticePeriod, studyDaysPerWeek);
        const availableDays = Math.max(1, studyDaysLeft);
        base = { quota: Math.ceil(remainingQuestions / availableDays), triageMode: false, availableDays };
      }
    }
  }

  const timeEstimate = estimateMaxQuotaFromHours(dailyStudyHours ?? 0);
  const hasTimeCap = timeEstimate.estimate > 0;
  const quota = hasTimeCap ? Math.min(base.quota, timeEstimate.estimate) : base.quota;

  return {
    ...base,
    quota,
    remainingQuestions,
    timeEstimate: hasTimeCap ? timeEstimate : null,
    timeCapped: hasTimeCap && quota < base.quota,
  };
}

export type ChapterAttemptStats = {
  chapterId: string;
  chapterName: string;
  subject: string;
  attempts: number;
  correct: number;
  lastAttemptAt: string;
};

export type ChapterReviewInfo = ChapterAttemptStats & {
  accuracy: number;
  daysSinceLastAttempt: number;
  idealIntervalDays: number;
};

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
    const idealIntervalDays = accuracy < 50 ? 1 : accuracy < 80 ? 7 : 30;

    if (daysSinceLastAttempt >= idealIntervalDays) {
      due.push({ ...stat, accuracy, daysSinceLastAttempt, idealIntervalDays });
    }
  }

  return due.sort((a, b) => {
    const urgencyA = (a.daysSinceLastAttempt / a.idealIntervalDays) * (1.1 - a.accuracy / 100);
    const urgencyB = (b.daysSinceLastAttempt / b.idealIntervalDays) * (1.1 - b.accuracy / 100);
    return urgencyB - urgencyA;
  });
}

/**
 * Splits today's total quota into a "review" portion (for chapters that are
 * due per the forgetting-curve schedule) and a "new" portion.
 */
export function splitQuotaForReview(totalQuota: number, dueChapterCount: number): { reviewQuota: number; newQuota: number } {
  if (totalQuota <= 0 || dueChapterCount === 0) {
    return { reviewQuota: 0, newQuota: totalQuota };
  }

  const reviewQuota = Math.min(totalQuota, Math.max(3, Math.round(totalQuota * 0.3)), dueChapterCount * 5);
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
 * In normal mode: Picks unpracticed (Unused) questions.
 * In triage mode: Picks Incorrect and Marked questions.
 */
export async function generateTodayMissionSession(
  userId: string,
  targetQuota: number,
  isTriageMode: boolean,
  subjectQuotas?: Record<string, number>,
  reviewChapterIds?: string[],
  reviewQuota?: number
): Promise<{ session: TestSession; orderedQuestions: any[] } | null> {
  if (targetQuota <= 0) return null;

  const subjects = await getSubjects();
  const allChapterQIds = await getAllQuestionIdsByChapter();

  // Determine what status filters to use based on mode
  const statusFilters: QuestionStatusFilter = isTriageMode
    ? { Unused: false, Incorrect: true, Marked: true, Omitted: false, Correct: false }
    : { Unused: true, Incorrect: false, Marked: false, Omitted: false, Correct: false };

  // Collect all eligible question IDs
  let allEligibleIds: string[] = [];
  
  // We process chapters in order. To make it "smart", we could rotate subjects
  // based on the day of year or just pick sequentially. For simplicity, we just
  // grab available questions until we hit quota, grouping by subject naturally.
  
  // Fetch the user's full progress map once, then filter locally to avoid
  // sending every question ID in a single `.in()` query (which exceeds Postgrest's URL limit).
  const progressMap = await getAllUserProgress(userId);
  const allIds = Object.values(allChapterQIds).flat();
  const filteredSet = new Set(
    allIds.filter((id) => {
      const progress = progressMap.get(id);
      if (!progress) return statusFilters.Unused;
      if (statusFilters.Marked && progress.is_marked) return true;
      if (statusFilters.Correct && progress.status === 'correct') return true;
      if (statusFilters.Incorrect && progress.status === 'incorrect') return true;
      if (statusFilters.Omitted && progress.status === 'omitted') return true;
      return false;
    }),
  );

  // Group filtered IDs by chapter so we don't jump between 7 subjects in one day
  const chapterToIds = new Map<string, string[]>();
  for (const chapter of subjects.flatMap(s => s.chapters)) {
    const ids = allChapterQIds[chapter.id] || [];
    const valid = ids.filter(id => filteredSet.has(id));
    if (valid.length > 0) {
      chapterToIds.set(chapter.id, valid);
    }
  }

  // Select questions up to targetQuota, taking full chapters if possible
  const selectedChapterIds = new Set<string>();
  let selectedIds: string[] = [];

  // Ebbinghaus spaced-repetition review: pull previously-answered questions
  // from chapters that are due for review, prioritizing ones the user got
  // wrong or marked, before allocating the remaining quota to new questions.
  if (reviewChapterIds && reviewChapterIds.length > 0 && (reviewQuota ?? 0) > 0) {
    const reviewCandidates: { id: string; score: number }[] = [];
    for (const chapId of reviewChapterIds) {
      const ids = allChapterQIds[chapId] || [];
      for (const id of ids) {
        const progress = progressMap.get(id);
        if (!progress) continue;
        const score = (progress.status === 'incorrect' ? 2 : 0) + (progress.is_marked ? 1 : 0);
        reviewCandidates.push({ id, score });
      }
    }

    const reviewPicked = reviewCandidates
      .sort((a, b) => b.score - a.score || Math.random() - 0.5)
      .slice(0, reviewQuota)
      .map((c) => c.id);

    if (reviewPicked.length > 0) {
      selectedIds.push(...reviewPicked);
      reviewChapterIds.forEach((chapId) => selectedChapterIds.add(chapId));
    }
  }

  if (subjectQuotas && Object.keys(subjectQuotas).length > 0) {
    // Confidence-weighted allocation: pull questions per subject according
    // to the quota computed by calculateSubjectQuotas().
    for (const subject of subjects) {
      const subjectQuota = subjectQuotas[subject.name] ?? 0;
      if (subjectQuota <= 0) continue;

      const subjectChapterIds = subject.chapters
        .map((c) => c.id)
        .filter((id) => chapterToIds.has(id))
        .sort(() => Math.random() - 0.5);

      let pickedForSubject = 0;
      for (const chapId of subjectChapterIds) {
        if (pickedForSubject >= subjectQuota) break;

        const ids = chapterToIds.get(chapId)!;
        const needed = subjectQuota - pickedForSubject;

        selectedChapterIds.add(chapId);

        const shuffledIds = [...ids].sort(() => Math.random() - 0.5);
        const picked = shuffledIds.slice(0, needed);
        selectedIds.push(...picked);
        pickedForSubject += picked.length;
      }
    }
  } else {
    // We could randomize which chapter we start with, or just go top-to-bottom.
    // We'll shuffle the chapters array slightly to give variety.
    const shuffledChapters = Array.from(chapterToIds.keys()).sort(() => Math.random() - 0.5);

    for (const chapId of shuffledChapters) {
      if (selectedIds.length >= targetQuota) break;

      const ids = chapterToIds.get(chapId)!;
      const needed = targetQuota - selectedIds.length;

      selectedChapterIds.add(chapId);

      // In normal mode we usually want sequential, in triage random is fine.
      // Let's randomize the questions within the chapter for variety
      const shuffledIds = [...ids].sort(() => Math.random() - 0.5);
      selectedIds.push(...shuffledIds.slice(0, needed));
    }
  }

  if (selectedIds.length === 0) return null;

  const questions = await getQuestionsByChapterIds(Array.from(selectedChapterIds), 99999);
  const selectedSet = new Set(selectedIds);
  const matchingQuestions = questions.filter(q => selectedSet.has(q.id));
  
  // Final shuffle of the selected questions
  const ordered = matchingQuestions.sort(() => Math.random() - 0.5);
  const finalIds = ordered.map(q => q.id);
  const subjectNames = Array.from(new Set(ordered.map(q => q.subject)));
  const chapterIdsArr = Array.from(selectedChapterIds);

  const dbSessionId = await createPracticeSessionRecord({
    userId,
    mode: 'Tutor', // Default to Tutor for daily missions
    subjectNames,
    chapterIds: chapterIdsArr,
    questionIds: finalIds,
  });

  const newSession: TestSession = {
    id: dbSessionId ?? crypto.randomUUID(),
    createdAt: Date.now(),
    mode: 'Tutor',
    subjects: subjectNames,
    chapters: chapterIdsArr,
    questionCount: finalIds.length,
    questionIds: finalIds,
    userAnswers: {},
    status: 'In-Progress',
    timeSpent: 0,
  };

  return { session: newSession, orderedQuestions: ordered };
}
