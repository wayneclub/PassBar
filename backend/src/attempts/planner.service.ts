import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import {
  chapters,
  planSnapshots,
  practiceAnswers,
  profiles,
  questionItems,
} from '../db/schema';
import { GeminiFeedbackService } from '../feedback/gemini-feedback.service';
import { QuestionsService } from '../questions/questions.service';
import { QuestionProgressService } from './question-progress.service';
import { PracticeSessionsService } from './practice-sessions.service';

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export const SECONDS_PER_QUESTION = 108;
export const LEARNING_SECONDS_PER_QUESTION = 300;

export type StudyPaceMode = 'leisure' | 'balanced' | 'intensive';
export type StudySubjectMode = 'singleThenMixed' | 'mixed';

export type TimeBasedQuotaEstimate = {
  estimate: number;
  min: number;
  max: number;
};

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

export type TodayMissionChapter = { id: string; name: string; subject: string };

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

export type PracticeAnswerChapterRow = {
  question_id: string;
  is_correct: boolean | null;
  time_spent_seconds: number | null;
  confidence?: string | null;
  answered_at: string | null;
  chapter: { id: string; chapter: string; subject: string } | null;
};

export type StudyPlanSettings = {
  examState?: string | null;
  examDate?: string | null;
  studyDaysPerWeek: number[];
  triageWeeks: number;
  subjectConfidence?: Record<string, number>;
  dailyStudyHours?: number;
  paceMode?: StudyPaceMode;
  subjectMode?: StudySubjectMode;
  subjectOrder?: string[];
  passThreshold?: number;
};

const defaultStudyPlan: StudyPlanSettings = {
  studyDaysPerWeek: [1, 2, 3, 4, 5],
  triageWeeks: 2,
  dailyStudyHours: 3,
  paceMode: 'balanced',
  subjectMode: 'singleThenMixed',
};

const PACE_FOCUS_RATIO: Record<StudyPaceMode, number> = {
  leisure: 45 / 60,
  balanced: 50 / 60,
  intensive: 55 / 60,
};

const MASTERY_INTERVALS = [1, 1, 3, 7, 14, 30] as const;
const POSSIBLE_GUESS_SECONDS = 30;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isLowConfidence(value: string | null | undefined) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return [
    'low',
    'guess',
    'guessed',
    'unsure',
    'uncertain',
    '不確定',
    '不确定',
    '猜',
  ].some((token) => normalized.includes(token));
}

function countStudyDays(
  start: Date,
  end: Date,
  studyDaysPerWeek: number[],
): number {
  const allowedSet = new Set(studyDaysPerWeek);
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    if (allowedSet.has(cursor.getDay())) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// ── 到考試日的投影排程（P2） ──────────────────────────────────────────────
export type PlanEntry = {
  chapterId: string;
  subject: string;
  chapterName: string;
  type: 'review' | 'practice';
  stage: number; // spaced-repetition 階段（複習）；新章節為 0
  occurrence: number; // 同一章第幾次出現，供日曆穩定 UID 用
};

export type PlanDay = { date: string; entries: PlanEntry[] }; // date = YYYY-MM-DD

export type ProjectionInput = {
  today: Date;
  examDate: Date | null;
  studyDaysPerWeek: number[];
  chapterStats: ChapterAttemptStats[];
  allChapters: Array<{ id: string; name: string; subject: string }>;
  newChaptersPerStudyDay: number;
};

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 回傳 date 當天或之後第一個「讀書日」；studyDaysPerWeek 空時視每天皆可讀。 */
function snapToStudyDay(date: Date, allowed: Set<number>): Date {
  const d = startOfLocalDay(date);
  if (allowed.size === 0) return d;
  for (let i = 0; i < 7; i += 1) {
    if (allowed.has(d.getDay())) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** 依 getDueReviewChapters 同款公式估算章節理想複習間隔（天）。 */
function idealIntervalForStat(stat: ChapterAttemptStats): number {
  const averageSeconds =
    (stat.timedAttempts ?? 0) > 0
      ? (stat.totalTimeSeconds ?? 0) / (stat.timedAttempts ?? 1)
      : 0;
  const masteryRate =
    (stat.questionCount ?? 0) > 0
      ? Math.round(
          ((stat.masteredQuestionCount ?? 0) / (stat.questionCount ?? 1)) * 100,
        )
      : 0;
  const accuracy =
    stat.attempts > 0 ? Math.round((stat.correct / stat.attempts) * 100) : 0;
  if ((stat.riskyQuestionCount ?? 0) > 0 || averageSeconds > SECONDS_PER_QUESTION)
    return 1;
  if (masteryRate >= 80) return 30;
  if (masteryRate >= 50) return 7;
  if (accuracy < 50) return 1;
  return 3;
}

function stageForInterval(interval: number): number {
  const idx = MASTERY_INTERVALS.findIndex((v) => v >= interval);
  return idx < 0 ? MASTERY_INTERVALS.length - 1 : idx;
}

/**
 * 前向投影：從今天到考試日，把「間隔複習」與「新章節」攤到各讀書日。
 * 純函數、不碰 DB —— 便於單元測試，且 compute-on-read 讓計劃天生依真實做題自我修正。
 */
export function buildProjection(input: ProjectionInput): PlanDay[] {
  const {
    today,
    examDate,
    studyDaysPerWeek,
    chapterStats,
    allChapters,
    newChaptersPerStudyDay,
  } = input;
  if (!examDate) return [];
  const allowed = new Set(studyDaysPerWeek);
  const start = startOfLocalDay(today);
  const exam = startOfLocalDay(examDate);
  if (exam <= start) return [];

  const MAX_STEPS = 400;
  const byDate = new Map<string, PlanEntry[]>();
  const push = (date: Date, entry: PlanEntry) => {
    const key = toIsoDate(date);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(entry);
  };

  // 1) 複習：每個已練章節，把 spaced-repetition 到期日往未來滾到考試日。
  for (const stat of chapterStats) {
    if (stat.attempts <= 0 || !stat.lastAttemptAt) continue;
    let stage = stageForInterval(idealIntervalForStat(stat));
    let interval = idealIntervalForStat(stat);
    const cursor = startOfLocalDay(new Date(stat.lastAttemptAt));
    cursor.setDate(cursor.getDate() + interval);
    let occurrence = 0;
    for (let steps = 0; steps < MAX_STEPS; steps += 1) {
      const base = cursor < start ? new Date(start) : new Date(cursor);
      const due = snapToStudyDay(base, allowed);
      if (startOfLocalDay(due) > exam) break;
      push(due, {
        chapterId: stat.chapterId,
        subject: stat.subject,
        chapterName: stat.chapterName,
        type: 'review',
        stage,
        occurrence,
      });
      occurrence += 1;
      stage = Math.min(stage + 1, MASTERY_INTERVALS.length - 1);
      interval = MASTERY_INTERVALS[stage];
      cursor.setTime(startOfLocalDay(due).getTime());
      cursor.setDate(cursor.getDate() + interval);
    }
  }

  // 2) 新章節：未練過的章節依序攤到各讀書日（每日上限 newChaptersPerStudyDay）。
  const studied = new Set(
    chapterStats.filter((s) => s.attempts > 0).map((s) => s.chapterId),
  );
  const backlog = allChapters.filter((c) => !studied.has(c.id));
  if (backlog.length > 0 && newChaptersPerStudyDay > 0) {
    let bi = 0;
    const day = snapToStudyDay(new Date(start), allowed);
    for (let guard = 0; guard < MAX_STEPS && bi < backlog.length; guard += 1) {
      if (startOfLocalDay(day) > exam) break;
      for (let k = 0; k < newChaptersPerStudyDay && bi < backlog.length; k += 1) {
        const c = backlog[bi];
        push(day, {
          chapterId: c.id,
          subject: c.subject,
          chapterName: c.name,
          type: 'practice',
          stage: 0,
          occurrence: 0,
        });
        bi += 1;
      }
      day.setDate(day.getDate() + 1);
      day.setTime(snapToStudyDay(day, allowed).getTime());
    }
  }

  return [...byDate.entries()]
    .map(([date, entries]) => ({ date, entries }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── 計劃快照與 diff（P4） ──────────────────────────────────────────────────
// 快照壓成 uid -> { d:日期, s:科目, c:章節, t:型別 }，方便持久化與跨日比對。
export type SnapshotMap = Record<
  string,
  { d: string; s: string; c: string; t: string }
>;

export type PlanDiff = {
  moved: Array<{ subject: string; chapter: string; type: string; from: string; to: string }>;
  added: Array<{ subject: string; chapter: string; type: string; date: string }>;
  removed: Array<{ subject: string; chapter: string; type: string; date: string }>;
};

export function projectionToSnapshot(planDays: PlanDay[]): SnapshotMap {
  const map: SnapshotMap = {};
  for (const day of planDays) {
    for (const e of day.entries) {
      map[`${e.chapterId}:${e.type}:${e.occurrence}`] = {
        d: day.date,
        s: e.subject,
        c: e.chapterName,
        t: e.type,
      };
    }
  }
  return map;
}

/** 比對前一版與當前投影，得出被挪動 / 新增 / 移除（已完成或不再需要）的項目。 */
export function diffProjection(prev: SnapshotMap, curr: SnapshotMap): PlanDiff {
  const diff: PlanDiff = { moved: [], added: [], removed: [] };
  for (const [uid, c] of Object.entries(curr)) {
    const p = prev[uid];
    if (!p) {
      diff.added.push({ subject: c.s, chapter: c.c, type: c.t, date: c.d });
    } else if (p.d !== c.d) {
      diff.moved.push({ subject: c.s, chapter: c.c, type: c.t, from: p.d, to: c.d });
    }
  }
  for (const [uid, p] of Object.entries(prev)) {
    if (!curr[uid]) {
      diff.removed.push({ subject: p.s, chapter: p.c, type: p.t, date: p.d });
    }
  }
  return diff;
}

@Injectable()
export class PlannerService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly questionsService: QuestionsService,
    private readonly questionProgressService: QuestionProgressService,
    private readonly practiceSessionsService: PracticeSessionsService,
    private readonly gemini: GeminiFeedbackService,
  ) {}

  getEffectiveStudyHours(
    dailyStudyHours: number,
    paceMode: StudyPaceMode = 'balanced',
  ) {
    if (!dailyStudyHours || dailyStudyHours <= 0) return 0;
    return dailyStudyHours * PACE_FOCUS_RATIO[paceMode];
  }

  estimateMaxQuotaFromHours(
    dailyStudyHours: number,
    paceMode: StudyPaceMode = 'balanced',
  ): TimeBasedQuotaEstimate {
    if (!dailyStudyHours || dailyStudyHours <= 0)
      return { estimate: 0, min: 0, max: 0 };
    const totalSeconds =
      this.getEffectiveStudyHours(dailyStudyHours, paceMode) * 3600;
    const estimate = Math.max(
      1,
      Math.round(totalSeconds / LEARNING_SECONDS_PER_QUESTION),
    );
    const variance = Math.max(1, Math.round(estimate * 0.15));
    return {
      estimate,
      min: Math.max(1, estimate - variance),
      max: estimate + variance,
    };
  }

  calculateSuggestedSubjectConfidence(
    subjects: SubjectConfidenceInput[],
  ): Record<string, number> {
    const result: Record<string, number> = {};
    subjects.forEach((subject) => {
      const answered = Math.max(
        subject.total,
        subject.correct + subject.incorrect,
      );
      if (answered <= 0) {
        result[subject.name] = 50;
        return;
      }
      const correctRate = subject.correct / answered;
      const wrongRate = subject.incorrect / answered;
      const rawConfidence = 50 + (correctRate - wrongRate) * 50;
      const sampleWeight = clamp(answered / 30, 0.15, 1);
      const timePenalty =
        (subject.averageSeconds ?? 0) > SECONDS_PER_QUESTION
          ? clamp(
              ((subject.averageSeconds ?? 0) - SECONDS_PER_QUESTION) /
                SECONDS_PER_QUESTION,
              0,
              1,
            ) * 20
          : 0;
      const riskPenalty = clamp(subject.riskyQuestionRatio ?? 0, 0, 1) * 20;
      const masteryRatio = clamp(subject.masteredQuestionRatio ?? 0, 0, 1);
      const spacedMasteryAdjustment =
        answered > 0 ? (masteryRatio - 0.5) * 20 : 0;
      result[subject.name] = Math.round(
        clamp(
          50 +
            (rawConfidence - 50) * sampleWeight -
            timePenalty -
            riskPenalty +
            spacedMasteryAdjustment,
          0,
          100,
        ),
      );
    });
    return result;
  }

  private reviewReserveRatio(dueReviewChapterCount: number) {
    return clamp(0.2 + dueReviewChapterCount * 0.01, 0.2, 0.35);
  }

  private buildQuotaPlan(
    remainingQuestions: number,
    base: { quota: number; triageMode: boolean; availableDays: number },
    dailyStudyHours: number | undefined,
    dueReviewChapterCount: number,
    paceMode: StudyPaceMode,
  ): DailyQuotaPlan {
    const reserveRatio =
      (remainingQuestions > 0 || dueReviewChapterCount > 0) &&
      base.availableDays > 0
        ? this.reviewReserveRatio(dueReviewChapterCount)
        : 0;
    const reviewDays =
      reserveRatio > 0
        ? Math.max(1, Math.ceil(base.availableDays * reserveRatio))
        : 0;
    const learningDays =
      reserveRatio > 0
        ? Math.max(1, base.availableDays - reviewDays)
        : base.availableDays;
    const newQuota =
      remainingQuestions > 0 && learningDays > 0
        ? Math.ceil(remainingQuestions / learningDays)
        : base.quota;
    const plannedReviewQuota =
      reserveRatio > 0 && dueReviewChapterCount > 0
        ? newQuota > 0
          ? Math.max(1, Math.round(newQuota * reserveRatio))
          : Math.min(20, dueReviewChapterCount * 5)
        : 0;
    const plannedTotalQuota = newQuota + plannedReviewQuota;

    const timeEstimate = this.estimateMaxQuotaFromHours(
      dailyStudyHours ?? 0,
      paceMode,
    );
    const hasTimeCap = timeEstimate.estimate > 0;
    const quota = hasTimeCap
      ? Math.min(plannedTotalQuota, timeEstimate.estimate)
      : plannedTotalQuota;
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

  calculateDailyQuota(
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
        base = {
          quota: remainingQuestions,
          triageMode: true,
          availableDays: 0,
        };
      } else {
        const daysUntilExam = Math.round(
          (examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        const triageDays = triageWeeks * 7;

        if (daysUntilExam <= triageDays) {
          const studyDaysLeft = countStudyDays(
            today,
            examDate,
            studyDaysPerWeek,
          );
          const availableDays = Math.max(1, studyDaysLeft);
          base = {
            quota:
              remainingQuestions > 0
                ? Math.ceil(remainingQuestions / availableDays)
                : 0,
            triageMode: true,
            availableDays,
          };
        } else {
          const endOfPracticePeriod = new Date(examDate);
          endOfPracticePeriod.setDate(
            endOfPracticePeriod.getDate() - triageDays,
          );
          const studyDaysLeft = countStudyDays(
            today,
            endOfPracticePeriod,
            studyDaysPerWeek,
          );
          const availableDays = Math.max(1, studyDaysLeft);
          base = {
            quota:
              remainingQuestions > 0
                ? Math.ceil(remainingQuestions / availableDays)
                : 0,
            triageMode: false,
            availableDays,
          };
        }
      }
    }

    return this.buildQuotaPlan(
      remainingQuestions,
      base,
      dailyStudyHours,
      dueReviewChapterCount,
      paceMode,
    );
  }

  assessQuestionMastery(
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

    const timed = ordered.filter(
      (attempt) => (attempt.timeSpentSeconds ?? 0) > 0,
    );
    const averageSeconds =
      timed.length > 0
        ? timed.reduce(
            (sum, attempt) => sum + (attempt.timeSpentSeconds ?? 0),
            0,
          ) / timed.length
        : 0;
    const everIncorrect = ordered.some((attempt) => !attempt.isCorrect);
    const last = ordered[ordered.length - 1];
    const slowRisk =
      (last.timeSpentSeconds ?? 0) > SECONDS_PER_QUESTION ||
      averageSeconds > SECONDS_PER_QUESTION;
    const guessRisk =
      isLowConfidence(last.confidence) ||
      (last.isCorrect &&
        (last.timeSpentSeconds ?? Number.POSITIVE_INFINITY) <
          POSSIBLE_GUESS_SECONDS);

    let reliableCorrectStreak = 0;
    const reliableDays = new Set<string>();
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const attempt = ordered[index];
      const seconds = attempt.timeSpentSeconds ?? 0;
      const reliable =
        attempt.isCorrect &&
        !isLowConfidence(attempt.confidence) &&
        (seconds <= 0 ||
          (seconds >= POSSIBLE_GUESS_SECONDS &&
            seconds <= SECONDS_PER_QUESTION));
      if (!reliable) break;
      reliableCorrectStreak += 1;
      reliableDays.add(
        startOfLocalDay(new Date(attempt.answeredAt))
          .toISOString()
          .slice(0, 10),
      );
    }

    const distinctReliableDays = reliableDays.size;
    const stage = Math.min(distinctReliableDays, MASTERY_INTERVALS.length - 1);
    const intervalDays = MASTERY_INTERVALS[stage];
    const lastAttemptDay = startOfLocalDay(new Date(last.answeredAt));
    const daysSinceLastAttempt = Math.max(
      0,
      Math.floor(
        (startOfLocalDay(now).getTime() - lastAttemptDay.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );
    const mastered =
      reliableCorrectStreak >= 3 &&
      distinctReliableDays >= 3 &&
      !slowRisk &&
      !guessRisk;
    const due = daysSinceLastAttempt >= intervalDays;
    const priority =
      (due ? 100 : 0) +
      (!last.isCorrect ? 80 : 0) +
      (everIncorrect ? 30 : 0) +
      (guessRisk ? 35 : 0) +
      (slowRisk ? 25 : 0) +
      Math.max(0, 3 - distinctReliableDays) * 10 +
      Math.max(0, daysSinceLastAttempt - intervalDays);

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

  computeChapterStats(
    chapterAnswerRows: PracticeAnswerChapterRow[],
  ): ChapterAttemptStats[] {
    type ChapterStatsAccumulator = ChapterAttemptStats & {
      questionIds: Set<string>;
      attemptsByQuestion: Map<
        string,
        Array<{
          isCorrect: boolean;
          answeredAt: string;
          timeSpentSeconds: number | null;
          confidence: string | null;
        }>
      >;
    };
    const chapterStatsMap = new Map<string, ChapterStatsAccumulator>();
    chapterAnswerRows.forEach((answer) => {
      const chapter = answer.chapter;
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
      existing.totalTimeSeconds =
        (existing.totalTimeSeconds ?? 0) + (answer.time_spent_seconds ?? 0);
      if ((answer.time_spent_seconds ?? 0) > 0)
        existing.timedAttempts = (existing.timedAttempts ?? 0) + 1;
      existing.questionIds.add(answer.question_id);
      if (answer.answered_at > existing.lastAttemptAt)
        existing.lastAttemptAt = answer.answered_at;
      const questionAttempts =
        existing.attemptsByQuestion.get(answer.question_id) ?? [];
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
      const assessments = Array.from(stat.attemptsByQuestion.values()).map(
        (attempts) => this.assessQuestionMastery(attempts),
      );
      return {
        chapterId: stat.chapterId,
        chapterName: stat.chapterName,
        subject: stat.subject,
        attempts: stat.attempts,
        correct: stat.correct,
        lastAttemptAt: stat.lastAttemptAt,
        totalAttempts: stat.attempts,
        lastAccuracy:
          stat.attempts > 0
            ? Math.round((stat.correct / stat.attempts) * 100)
            : null,
        totalTimeSeconds: stat.totalTimeSeconds,
        timedAttempts: stat.timedAttempts,
        questionCount: stat.questionIds.size,
        dueQuestionCount: assessments.filter((a) => a.due).length,
        riskyQuestionCount: assessments.filter(
          (a) => a.slowRisk || a.guessRisk || (a.everIncorrect && !a.mastered),
        ).length,
        masteredQuestionCount: assessments.filter((a) => a.mastered).length,
      };
    });
  }

  getDueReviewChapters(
    chapterStats: ChapterAttemptStats[],
  ): ChapterReviewInfo[] {
    const today = startOfLocalDay(new Date()).getTime();
    const due: ChapterReviewInfo[] = [];
    for (const stat of chapterStats) {
      if (stat.attempts === 0 || !stat.lastAttemptAt) continue;

      const accuracy = Math.round((stat.correct / stat.attempts) * 100);
      const lastAttemptDay = startOfLocalDay(
        new Date(stat.lastAttemptAt),
      ).getTime();
      const daysSinceLastAttempt = Math.round(
        (today - lastAttemptDay) / (1000 * 60 * 60 * 24),
      );
      const averageSeconds =
        (stat.timedAttempts ?? 0) > 0
          ? (stat.totalTimeSeconds ?? 0) / (stat.timedAttempts ?? 1)
          : 0;
      const masteryRate =
        (stat.questionCount ?? 0) > 0
          ? Math.round(
              ((stat.masteredQuestionCount ?? 0) / (stat.questionCount ?? 1)) *
                100,
            )
          : 0;
      const hasDetailedAssessment = stat.dueQuestionCount !== undefined;
      const idealIntervalDays =
        (stat.riskyQuestionCount ?? 0) > 0 ||
        averageSeconds > SECONDS_PER_QUESTION
          ? 1
          : masteryRate >= 80
            ? 30
            : masteryRate >= 50
              ? 7
              : accuracy < 50
                ? 1
                : 3;

      if (
        (hasDetailedAssessment && (stat.dueQuestionCount ?? 0) > 0) ||
        (!hasDetailedAssessment && daysSinceLastAttempt >= idealIntervalDays)
      ) {
        due.push({
          ...stat,
          accuracy,
          daysSinceLastAttempt,
          idealIntervalDays,
          averageSeconds,
          masteryRate,
        });
      }
    }

    return due.sort((a, b) => {
      const urgencyA =
        (a.dueQuestionCount ?? 1) * 2 +
        (a.riskyQuestionCount ?? 0) +
        (a.daysSinceLastAttempt / a.idealIntervalDays) *
          (1.1 - a.masteryRate / 100);
      const urgencyB =
        (b.dueQuestionCount ?? 1) * 2 +
        (b.riskyQuestionCount ?? 0) +
        (b.daysSinceLastAttempt / b.idealIntervalDays) *
          (1.1 - b.masteryRate / 100);
      return urgencyB - urgencyA;
    });
  }

  splitQuotaForReview(
    totalQuota: number,
    dueChapterCount: number,
    plannedReviewQuota?: number,
  ) {
    if (totalQuota <= 0 || dueChapterCount === 0)
      return { reviewQuota: 0, newQuota: totalQuota };
    const desired =
      plannedReviewQuota ?? Math.max(3, Math.round(totalQuota * 0.3));
    const reviewQuota = Math.min(totalQuota, desired, dueChapterCount * 5);
    return { reviewQuota, newQuota: totalQuota - reviewQuota };
  }

  calculateSubjectQuotas(
    subjects: Array<{ name: string; remaining: number }>,
    totalQuota: number,
    confidence: Record<string, number>,
  ): Record<string, number> {
    const eligible = subjects.filter((s) => s.remaining > 0);
    if (eligible.length === 0 || totalQuota <= 0) return {};

    const weights = eligible.map((s) =>
      Math.max(5, 100 - (confidence[s.name] ?? 50)),
    );
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    const result: Record<string, number> = {};
    let allocated = 0;
    eligible.forEach((s, i) => {
      const raw = Math.floor((weights[i] / totalWeight) * totalQuota);
      const capped = Math.min(raw, s.remaining);
      result[s.name] = capped;
      allocated += capped;
    });

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

  private weightedSubjectOrder(
    subjects: Array<{ name: string; remaining: number }>,
    confidence: Record<string, number>,
    subjectOrder?: string[],
  ) {
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

  getStudyDayIndexFromToday(date: Date, studyDaysPerWeek: number[]): number {
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

  getFocusSubjectForDate(
    subjects: Array<{ name: string; remaining: number }>,
    confidence: Record<string, number>,
    studyDaysPerWeek: number[],
    date = new Date(),
    subjectOrder?: string[],
  ): string | null {
    const ordered = this.weightedSubjectOrder(
      subjects,
      confidence,
      subjectOrder,
    );
    if (ordered.length === 0) return null;
    const idx =
      this.getStudyDayIndexFromToday(date, studyDaysPerWeek) % ordered.length;
    return ordered[idx].name;
  }

  calculatePlannedSubjectQuotas(
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
      const focus = this.getFocusSubjectForDate(
        subjects,
        confidence,
        studyDaysPerWeek,
        date,
        subjectOrder,
      );
      if (!focus) return {};
      const remaining =
        subjects.find((subject) => subject.name === focus)?.remaining ?? 0;
      return { [focus]: Math.min(totalQuota, remaining) };
    }
    return this.calculateSubjectQuotas(subjects, totalQuota, confidence);
  }

  getPlannedChapterIdsForDate(
    subjects: Array<{
      name: string;
      chapters: Array<{ id: string; count: number }>;
    }>,
    subjectQuotas: Record<string, number>,
    subjectMode: StudySubjectMode,
    isTriageMode: boolean,
    studyDaysPerWeek: number[],
    date = new Date(),
  ): string[] {
    const activeSubjects = subjects
      .filter((subject) => (subjectQuotas[subject.name] ?? 0) > 0)
      .sort(
        (a, b) => (subjectQuotas[b.name] ?? 0) - (subjectQuotas[a.name] ?? 0),
      );
    const mixed = subjectMode === 'mixed' || isTriageMode;
    const selectedSubjects = mixed
      ? activeSubjects.slice(0, 3)
      : activeSubjects.slice(0, 1);
    const studyDayIndex = this.getStudyDayIndexFromToday(
      date,
      studyDaysPerWeek,
    );

    return selectedSubjects.flatMap((subject) => {
      const chs = subject.chapters.filter((chapter) => chapter.count > 0);
      if (chs.length === 0) return [];
      const start = studyDayIndex % chs.length;
      const count = mixed ? 1 : Math.min(2, chs.length);
      return Array.from(
        { length: count },
        (_, offset) => chs[(start + offset) % chs.length].id,
      );
    });
  }

  private async getPracticeAnswerChapterRows(
    userId: string,
  ): Promise<PracticeAnswerChapterRow[]> {
    const rows = await this.db
      .select({
        question_id: practiceAnswers.questionId,
        is_correct: practiceAnswers.isCorrect,
        time_spent_seconds: practiceAnswers.timeSpentSeconds,
        confidence: practiceAnswers.confidence,
        answered_at: practiceAnswers.answeredAt,
        chapterId: chapters.id,
        chapterName: chapters.chapter,
        chapterSubject: chapters.subject,
      })
      .from(practiceAnswers)
      .innerJoin(
        questionItems,
        eq(questionItems.id, practiceAnswers.questionId),
      )
      .innerJoin(chapters, eq(chapters.id, questionItems.chapterId))
      .where(eq(practiceAnswers.userId, userId));

    return rows.map((r) => ({
      question_id: r.question_id,
      is_correct: r.is_correct,
      time_spent_seconds: r.time_spent_seconds,
      confidence: r.confidence,
      answered_at: r.answered_at ? r.answered_at.toISOString() : null,
      chapter: {
        id: r.chapterId,
        chapter: r.chapterName,
        subject: r.chapterSubject,
      },
    }));
  }

  async fetchDueReviewChaptersForUser(
    userId: string,
  ): Promise<ChapterReviewInfo[]> {
    const rows = await this.getPracticeAnswerChapterRows(userId);
    const chapterStats = this.computeChapterStats(rows);
    return this.getDueReviewChapters(chapterStats);
  }

  /**
   * 投影從今天到考試日的完整排程（compute-on-read）。計劃頁與日曆 feed 都吃這個，
   * 使用者一做題 → mastery 變 → 下次讀取自動重算，達成「動態智能修正」。
   */
  async projectSchedule(userId: string): Promise<PlanDay[]> {
    const rows = await this.getPracticeAnswerChapterRows(userId);
    const chapterStats = this.computeChapterStats(rows);
    const [subjects, profile] = await Promise.all([
      this.questionsService.getSubjectsGrouped(),
      this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) }),
    ]);

    const settings = (profile?.studySettings ?? {}) as {
      studyPlan?: StudyPlanSettings;
    };
    const plan = settings.studyPlan ?? defaultStudyPlan;
    const studyDaysPerWeek =
      plan.studyDaysPerWeek ?? defaultStudyPlan.studyDaysPerWeek;
    const examDateIso = profile?.examDate ?? plan.examDate ?? null;
    const subjectOrder = plan.subjectOrder;

    const orderedSubjects =
      subjectOrder && subjectOrder.length > 0
        ? [...subjects].sort(
            (a, b) =>
              (subjectOrder.indexOf(a.name) + 1 || 999) -
              (subjectOrder.indexOf(b.name) + 1 || 999),
          )
        : subjects;
    const allChapters = orderedSubjects.flatMap((s) =>
      s.chapters.map((c) => ({ id: c.id, name: c.name, subject: s.name })),
    );

    const today = startOfLocalDay(new Date());
    const examDate = examDateIso
      ? startOfLocalDay(new Date(examDateIso + 'T00:00:00'))
      : null;

    const studied = new Set(
      chapterStats.filter((s) => s.attempts > 0).map((s) => s.chapterId),
    );
    const backlog = allChapters.filter((c) => !studied.has(c.id)).length;
    const studyDayCount = examDate
      ? countStudyDays(today, examDate, studyDaysPerWeek)
      : 0;
    const newChaptersPerStudyDay =
      studyDayCount > 0 ? clamp(Math.ceil(backlog / studyDayCount), 1, 8) : 1;

    return buildProjection({
      today,
      examDate,
      studyDaysPerWeek,
      chapterStats,
      allChapters,
      newChaptersPerStudyDay,
    });
  }

  /**
   * AI 助手每日簡報（P4）：對比前一版投影，讓 Gemini 敘述「計劃如何調整、為何、今天重點」，
   * 並落地今日快照供下次比對。
   */
  async generatePlanBriefing(userId: string, interfaceLanguage?: string) {
    const planDays = await this.projectSchedule(userId);
    const current = projectionToSnapshot(planDays);
    const todayIso = toIsoDate(startOfLocalDay(new Date()));

    const prevRow = await this.db.query.planSnapshots.findFirst({
      where: and(
        eq(planSnapshots.userId, userId),
        lt(planSnapshots.snapshotDate, todayIso),
      ),
      orderBy: desc(planSnapshots.snapshotDate),
    });
    const prev = (prevRow?.snapshot ?? {}) as SnapshotMap;
    const diff = diffProjection(prev, current);

    // upsert 今日快照（同日多次呼叫只更新內容，比對對象仍是「前一天」）
    await this.db
      .insert(planSnapshots)
      .values({ userId, snapshotDate: todayIso, snapshot: current })
      .onConflictDoUpdate({
        target: [planSnapshots.userId, planSnapshots.snapshotDate],
        set: { snapshot: current, createdAt: new Date() },
      });

    let narrative = '';
    let model: string | null = null;
    try {
      const result = await this.gemini.runPrompt(
        this.buildBriefingPrompt(
          planDays,
          diff,
          Boolean(prevRow),
          interfaceLanguage,
        ),
      );
      narrative = result.feedback;
      model = result.model;
    } catch {
      // Gemini 全掛時仍回結構化 diff，前端可自行呈現，不讓簡報整個失敗。
      narrative = '';
    }

    return {
      narrative,
      model,
      hasPrevious: Boolean(prevRow),
      diff,
      upcoming: planDays.slice(0, 7),
    };
  }

  private buildBriefingPrompt(
    planDays: PlanDay[],
    diff: PlanDiff,
    hasPrevious: boolean,
    interfaceLanguage?: string,
  ): string {
    const lang =
      interfaceLanguage === 'zh-Hant'
        ? 'Respond in Traditional Chinese.'
        : interfaceLanguage === 'zh-Hans'
          ? 'Respond in Simplified Chinese.'
          : 'Respond in English.';

    const today = planDays[0];
    const todayList = today
      ? today.entries
          .map(
            (e) =>
              `- ${e.type === 'review' ? 'Review' : 'New'}: ${e.subject} / ${e.chapterName}`,
          )
          .join('\n')
      : '(no items scheduled today)';

    const fmt = (arr: Array<{ subject: string; chapter: string }>, n = 6) =>
      arr
        .slice(0, n)
        .map((x) => `${x.subject} / ${x.chapter}`)
        .join('; ') || 'none';

    const changeBlock = hasPrevious
      ? `Since your last plan:
- Rescheduled: ${
          diff.moved
            .slice(0, 6)
            .map((m) => `${m.subject}/${m.chapter} ${m.from}→${m.to}`)
            .join('; ') || 'none'
        }
- Newly added: ${fmt(diff.added)}
- Dropped or completed: ${fmt(diff.removed)}`
      : 'This is the first plan snapshot (no previous plan to compare).';

    return `You are PassBar's MBE study assistant. Give a short, encouraging daily briefing (max ~120 words).

${lang}

${changeBlock}

Today's scheduled items (${today?.date ?? 'n/a'}):
${todayList}

Write, as flowing prose (no markdown headers):
1. One sentence on what changed in the plan and the likely reason (tie any rescheduling to progress or weak areas when plausible).
2. Today's focus in one or two sentences.
3. One short encouraging line.
Do not mention that you are an AI model.`;
  }

  async fetchTodayMissionForUser(userId: string) {
    const rows = await this.getPracticeAnswerChapterRows(userId);
    const chapterStats = this.computeChapterStats(rows);
    const reviewChapters = this.getDueReviewChapters(chapterStats);

    const answeredBySubject = new Map<string, Set<string>>();
    for (const row of rows) {
      const subj = row.chapter?.subject;
      if (!subj || !row.question_id) continue;
      if (!answeredBySubject.has(subj)) answeredBySubject.set(subj, new Set());
      answeredBySubject.get(subj)!.add(row.question_id);
    }

    const [subjects, profile] = await Promise.all([
      this.questionsService.getSubjectsGrouped(),
      this.db.query.profiles.findFirst({ where: eq(profiles.id, userId) }),
    ]);

    const settings = (profile?.studySettings ?? {}) as {
      studyPlan?: StudyPlanSettings;
    };
    const plan = settings.studyPlan ?? defaultStudyPlan;
    const subjectMode: StudySubjectMode = plan.subjectMode ?? 'singleThenMixed';
    const studyDaysPerWeek =
      plan.studyDaysPerWeek ?? defaultStudyPlan.studyDaysPerWeek;
    const paceMode: StudyPaceMode = plan.paceMode ?? 'balanced';
    const dailyStudyHours =
      plan.dailyStudyHours ?? defaultStudyPlan.dailyStudyHours ?? 3;
    const triageWeeks = plan.triageWeeks ?? defaultStudyPlan.triageWeeks;
    const examDate = profile?.examDate ?? plan.examDate ?? null;
    const savedConfidence = plan.subjectConfidence;
    const subjectOrder = plan.subjectOrder;

    const missionTotal = subjects.reduce((s, sub) => s + sub.count, 0);

    const subjectsWithRemaining = subjects.map((s) => {
      const answered = answeredBySubject.get(s.name)?.size ?? 0;
      return {
        name: s.name,
        total: s.count,
        remaining: Math.max(0, s.count - answered),
        correct: 0,
        incorrect: 0,
        answered,
        averageSeconds: 0,
        riskyQuestionRatio: 0,
        masteredQuestionRatio: 0,
      };
    });

    const missionPracticed = subjectsWithRemaining.reduce(
      (s, sub) => s + sub.answered,
      0,
    );

    const quotaInfo = this.calculateDailyQuota(
      missionTotal,
      missionPracticed,
      examDate,
      studyDaysPerWeek,
      triageWeeks,
      dailyStudyHours,
      reviewChapters.length,
      paceMode,
    );

    const defaultConfidence = this.calculateSuggestedSubjectConfidence(
      subjectsWithRemaining,
    );
    const subjectConfidence = {
      ...defaultConfidence,
      ...(savedConfidence ?? {}),
    };
    const reviewSplit = this.splitQuotaForReview(
      quotaInfo.quota,
      reviewChapters.length,
      quotaInfo.reviewQuota,
    );
    const subjectQuotas = this.calculatePlannedSubjectQuotas(
      subjectsWithRemaining,
      reviewSplit.newQuota,
      subjectConfidence,
      subjectMode,
      quotaInfo.triageMode,
      studyDaysPerWeek,
      new Date(),
      subjectOrder,
    );

    const plannedIds = this.getPlannedChapterIdsForDate(
      subjects,
      subjectQuotas,
      subjectMode,
      quotaInfo.triageMode,
      studyDaysPerWeek,
    );

    const newChapters = plannedIds.flatMap((id) => {
      for (const s of subjects) {
        const ch = s.chapters.find((c) => c.id === id);
        if (ch) return [{ id, name: ch.name, subject: s.name }];
      }
      return [];
    });

    return { newChapters, reviewChapters };
  }

  async generateTodayMissionSession(
    userId: string,
    targetQuota: number,
    subjectQuotas?: Record<string, number>,
    reviewChapterIds?: string[],
    reviewQuota?: number,
    preferredNewChapterIds?: string[],
  ) {
    if (targetQuota <= 0) return null;

    const subjects = await this.questionsService.getSubjectsGrouped();
    const allChapterQIds =
      await this.questionsService.getAllQuestionIdsByChapter();
    const progressMap =
      await this.questionProgressService.getAllUserProgress(userId);

    const allIds = Object.values(allChapterQIds).flat();
    const filteredSet = new Set(
      allIds.filter((id) => {
        const progress = progressMap[id];
        return !progress || progress.status === 'omitted';
      }),
    );

    const chapterToIds = new Map<string, string[]>();
    for (const chapter of subjects.flatMap((s) => s.chapters)) {
      const ids = allChapterQIds[chapter.id] || [];
      const valid = ids.filter((id) => filteredSet.has(id));
      if (valid.length > 0) chapterToIds.set(chapter.id, valid);
    }

    const selectedChapterIds = new Set<string>();
    const selectedIds: string[] = [];

    if (
      reviewChapterIds &&
      reviewChapterIds.length > 0 &&
      (reviewQuota ?? 0) > 0
    ) {
      const rows = await this.db
        .select({
          questionId: practiceAnswers.questionId,
          isCorrect: practiceAnswers.isCorrect,
          answeredAt: practiceAnswers.answeredAt,
          timeSpentSeconds: practiceAnswers.timeSpentSeconds,
          confidence: practiceAnswers.confidence,
        })
        .from(practiceAnswers)
        .where(eq(practiceAnswers.userId, userId))
        .limit(10000);

      const historyByQuestion = new Map<string, QuestionAttemptSignal[]>();
      rows.forEach((answer) => {
        if (!answer.questionId || !answer.answeredAt) return;
        const attempts = historyByQuestion.get(answer.questionId) ?? [];
        attempts.push({
          isCorrect: Boolean(answer.isCorrect),
          answeredAt: answer.answeredAt.toISOString(),
          timeSpentSeconds: answer.timeSpentSeconds,
          confidence: answer.confidence,
        });
        historyByQuestion.set(answer.questionId, attempts);
      });

      const reviewCandidates: { id: string; score: number }[] = [];
      for (const chapId of reviewChapterIds) {
        const ids = allChapterQIds[chapId] || [];
        for (const id of ids) {
          const progress = progressMap[id];
          if (!progress) continue;
          const history = historyByQuestion.get(id) ?? [];
          if (history.length > 0) {
            const assessment = this.assessQuestionMastery(history);
            if (!assessment.due) continue;
            reviewCandidates.push({
              id,
              score: assessment.priority + (progress.isMarked ? 20 : 0),
            });
            continue;
          }
          if (progress.status === 'incorrect' || progress.isMarked) {
            reviewCandidates.push({
              id,
              score:
                (progress.status === 'incorrect' ? 100 : 0) +
                (progress.isMarked ? 20 : 0),
            });
          }
        }
      }

      const reviewPicked = reviewCandidates
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, reviewQuota)
        .map((c) => c.id);

      if (reviewPicked.length > 0) {
        selectedIds.push(...reviewPicked);
        reviewChapterIds.forEach((chapId) => selectedChapterIds.add(chapId));
      }
    }

    if (subjectQuotas && Object.keys(subjectQuotas).length > 0) {
      for (const subject of subjects) {
        const subjectQuota = subjectQuotas[subject.name] ?? 0;
        if (subjectQuota <= 0) continue;

        const subjectChapterIds = subject.chapters
          .map((c) => c.id)
          .filter((id) => chapterToIds.has(id))
          .sort((a, b) => {
            const preferredA = preferredNewChapterIds?.includes(a) ? 0 : 1;
            const preferredB = preferredNewChapterIds?.includes(b) ? 0 : 1;
            return preferredA - preferredB || Math.random() - 0.5;
          });

        let pickedForSubject = 0;
        const preferredForSubject = subjectChapterIds.filter((id) =>
          preferredNewChapterIds?.includes(id),
        );

        if (preferredForSubject.length > 0) {
          const baseTarget = Math.floor(
            subjectQuota / preferredForSubject.length,
          );
          const remainder = subjectQuota % preferredForSubject.length;
          preferredForSubject.forEach((chapId, index) => {
            const ids = chapterToIds.get(chapId)!;
            const chapterTarget = Math.max(
              1,
              baseTarget + (index < remainder ? 1 : 0),
            );
            selectedChapterIds.add(chapId);
            const picked = [...ids]
              .sort(() => Math.random() - 0.5)
              .slice(0, chapterTarget);
            selectedIds.push(...picked);
            pickedForSubject += picked.length;
          });
        }

        for (const chapId of subjectChapterIds) {
          if (pickedForSubject >= subjectQuota) break;
          if (preferredForSubject.includes(chapId)) continue;

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
      const shuffledChapters = Array.from(chapterToIds.keys()).sort(
        () => Math.random() - 0.5,
      );
      for (const chapId of shuffledChapters) {
        if (selectedIds.length >= targetQuota) break;
        const ids = chapterToIds.get(chapId)!;
        const needed = targetQuota - selectedIds.length;
        selectedChapterIds.add(chapId);
        const shuffledIds = [...ids].sort(() => Math.random() - 0.5);
        selectedIds.push(...shuffledIds.slice(0, needed));
      }
    }

    return this.finalizeSession(userId, selectedIds, selectedChapterIds);
  }

  async generateIncorrectSession(userId: string, targetQuota: number) {
    if (targetQuota <= 0) return null;

    const subjects = await this.questionsService.getSubjectsGrouped();
    const allChapterQIds =
      await this.questionsService.getAllQuestionIdsByChapter();
    const progressMap =
      await this.questionProgressService.getAllUserProgress(userId);

    const allIds = Object.values(allChapterQIds).flat();
    const filteredSet = new Set(
      allIds.filter((id) => progressMap[id]?.status === 'incorrect'),
    );

    const chapterToIds = new Map<string, string[]>();
    for (const chapter of subjects.flatMap((s) => s.chapters)) {
      const ids = allChapterQIds[chapter.id] || [];
      const valid = ids.filter((id) => filteredSet.has(id));
      if (valid.length > 0) chapterToIds.set(chapter.id, valid);
    }

    const selectedChapterIds = new Set<string>();
    const selectedIds: string[] = [];
    const shuffledChapters = Array.from(chapterToIds.keys()).sort(
      () => Math.random() - 0.5,
    );

    for (const chapId of shuffledChapters) {
      if (selectedIds.length >= targetQuota) break;
      const ids = chapterToIds.get(chapId)!;
      const needed = targetQuota - selectedIds.length;
      selectedChapterIds.add(chapId);
      const shuffledIds = [...ids].sort(() => Math.random() - 0.5);
      selectedIds.push(...shuffledIds.slice(0, needed));
    }

    return this.finalizeSession(userId, selectedIds, selectedChapterIds);
  }

  private async finalizeSession(
    userId: string,
    selectedIds: string[],
    selectedChapterIds: Set<string>,
  ) {
    if (selectedIds.length === 0) return null;

    const questions = await this.questionsService.getQuestionsByChapterIds(
      Array.from(selectedChapterIds),
      99999,
    );
    const selectedSet = new Set(selectedIds);
    const matchingQuestions = questions.filter((q) => selectedSet.has(q.id));

    const ordered = matchingQuestions.sort(() => Math.random() - 0.5);
    const finalIds = ordered.map((q) => q.id);
    const subjectNames = Array.from(new Set(ordered.map((q) => q.subject)));
    const chapterIdsArr = Array.from(selectedChapterIds);

    const dbSessionId = await this.practiceSessionsService.createSession({
      userId,
      mode: 'Tutor',
      subjectNames,
      chapterIds: chapterIdsArr,
      questionIds: finalIds,
    });

    const newSession = {
      id: dbSessionId,
      createdAt: Date.now(),
      mode: 'Tutor' as const,
      subjects: subjectNames,
      chapters: chapterIdsArr,
      questionCount: finalIds.length,
      questionIds: finalIds,
      userAnswers: {},
      status: 'In-Progress' as const,
      timeSpent: 0,
    };

    return { session: newSession, orderedQuestions: ordered };
  }
}
