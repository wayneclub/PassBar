// Sends push notifications for due smart reviews, daily reminders and exam
// countdowns. Run on a schedule by .github/workflows/push-notifications.yml
// (GitHub Pages can't host the /api/cron/notifications route since it requires
// a server runtime).

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? '';
const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:support@passbar.app';

if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey) {
  console.error('Missing Supabase/VAPID environment variables.');
  process.exit(1);
}

const SECONDS_PER_QUESTION = 108;
const MASTERY_INTERVALS = [1, 1, 3, 7, 14, 30];
const POSSIBLE_GUESS_SECONDS = 30;

const defaultNotificationSettings = {
  enabled: false,
  smartReview: false,
  dailyReminder: false,
  dailyReminderTime: '20:00',
  examCountdown: false,
};

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isLowConfidence(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['low', 'guess', 'guessed', 'unsure', 'uncertain', '不確定', '不确定', '猜'].some((token) => normalized.includes(token));
}

/** Mirrors assessQuestionMastery() in src/lib/smart-planner.ts */
function assessQuestionMastery(attempts, now = new Date()) {
  const ordered = attempts
    .filter((attempt) => Boolean(attempt.answeredAt))
    .slice()
    .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));

  if (ordered.length === 0) {
    return { mastered: false, due: false };
  }

  const timed = ordered.filter((attempt) => (attempt.timeSpentSeconds ?? 0) > 0);
  const averageSeconds = timed.length > 0
    ? timed.reduce((sum, attempt) => sum + (attempt.timeSpentSeconds ?? 0), 0) / timed.length
    : 0;
  const last = ordered[ordered.length - 1];
  const slowRisk = (last.timeSpentSeconds ?? 0) > SECONDS_PER_QUESTION || averageSeconds > SECONDS_PER_QUESTION;
  const guessRisk = isLowConfidence(last.confidence)
    || (last.isCorrect && (last.timeSpentSeconds ?? Number.POSITIVE_INFINITY) < POSSIBLE_GUESS_SECONDS);

  let reliableCorrectStreak = 0;
  const reliableDays = new Set();
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

  return { mastered, due };
}

/** Mirrors computeChapterStats() in src/lib/smart-planner.ts */
function computeChapterStats(chapterAnswerRows) {
  const chapterStatsMap = new Map();
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
      totalTimeSeconds: 0,
      timedAttempts: 0,
      questionIds: new Set(),
      attemptsByQuestion: new Map(),
    };

    existing.attempts += 1;
    if (answer.is_correct) existing.correct += 1;
    existing.totalTimeSeconds += answer.time_spent_seconds ?? 0;
    if ((answer.time_spent_seconds ?? 0) > 0) existing.timedAttempts += 1;
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
      attempts: stat.attempts,
      correct: stat.correct,
      lastAttemptAt: stat.lastAttemptAt,
      totalTimeSeconds: stat.totalTimeSeconds,
      timedAttempts: stat.timedAttempts,
      questionCount: stat.questionIds.size,
      dueQuestionCount: assessments.filter((a) => a.due).length,
    };
  });
}

/** Mirrors getDueReviewChapters() in src/lib/smart-planner.ts (only what's needed to count due chapters) */
function getDueReviewChapters(chapterStats) {
  const today = startOfLocalDay(new Date()).getTime();
  const due = [];
  for (const stat of chapterStats) {
    if (stat.attempts === 0 || !stat.lastAttemptAt) continue;

    const lastAttemptDay = startOfLocalDay(new Date(stat.lastAttemptAt)).getTime();
    const daysSinceLastAttempt = Math.round((today - lastAttemptDay) / (1000 * 60 * 60 * 24));
    const hasDetailedAssessment = stat.dueQuestionCount !== undefined;
    const idealIntervalDays = 3;

    if ((hasDetailedAssessment && stat.dueQuestionCount > 0)
      || (!hasDetailedAssessment && daysSinceLastAttempt >= idealIntervalDays)) {
      due.push(stat);
    }
  }
  return due;
}

function normalizeNotifications(studySettings) {
  const raw = studySettings?.notifications ?? {};
  return {
    enabled: raw.enabled ?? defaultNotificationSettings.enabled,
    smartReview: raw.smartReview ?? defaultNotificationSettings.smartReview,
    dailyReminder: raw.dailyReminder ?? defaultNotificationSettings.dailyReminder,
    dailyReminderTime: typeof raw.dailyReminderTime === 'string' && /^\d{2}:\d{2}$/.test(raw.dailyReminderTime)
      ? raw.dailyReminderTime
      : defaultNotificationSettings.dailyReminderTime,
    examCountdown: raw.examCountdown ?? defaultNotificationSettings.examCountdown,
  };
}

function daysUntil(dateStr) {
  const today = new Date();
  const examDate = new Date(dateStr);
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfExam = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
  return Math.round((startOfExam.getTime() - startOfToday.getTime()) / msPerDay);
}

async function main() {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id, profiles(id, study_settings, exam_date)');

  if (error) {
    console.error('Failed to load push subscriptions:', error.message);
    process.exit(1);
  }

  const subscriptions = data ?? [];
  const currentUtcHour = new Date().getUTCHours();

  let sent = 0;
  let removed = 0;

  for (const sub of subscriptions) {
    const profile = sub.profiles;
    if (!profile) continue;

    const notifications = normalizeNotifications(profile.study_settings);
    if (!notifications.enabled) continue;

    const messages = [];

    if (notifications.smartReview) {
      const { data: answers } = await admin
        .from('practice_answers')
        .select('question_id, is_correct, time_spent_seconds, confidence, answered_at, question_items(chapters(id, chapter, subject))')
        .eq('user_id', sub.user_id);

      const dueChapters = getDueReviewChapters(computeChapterStats(answers ?? []));
      if (dueChapters.length > 0) {
        messages.push({
          title: 'PassBar',
          body: `You have ${dueChapters.length} chapter${dueChapters.length > 1 ? 's' : ''} due for review.`,
          url: './dashboard',
          tag: 'smart-review',
        });
      }
    }

    const reminderHour = Number(notifications.dailyReminderTime.split(':')[0]);

    if (notifications.dailyReminder && reminderHour === currentUtcHour) {
      messages.push({
        title: 'PassBar',
        body: "It's time for your daily study session!",
        url: './dashboard',
        tag: 'daily-reminder',
      });
    }

    if (notifications.examCountdown && profile.exam_date && reminderHour === currentUtcHour) {
      const remaining = daysUntil(profile.exam_date);
      if (remaining >= 0) {
        messages.push({
          title: 'PassBar',
          body: remaining === 0 ? 'Your exam is today. Good luck!' : `${remaining} day${remaining > 1 ? 's' : ''} until your exam.`,
          url: './dashboard',
          tag: 'exam-countdown',
        });
      }
    }

    for (const message of messages) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(message),
        );
        sent += 1;
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
          removed += 1;
        } else {
          console.warn('Failed to send push:', err);
        }
      }
    }
  }

  console.log(`Done. sent=${sent} removed=${removed}`);
}

main();
