import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { computeChapterStats, getDueReviewChapters, type PracticeAnswerChapterRow } from '@/lib/smart-planner';
import { normalizeStudySettings, type StudySettings } from '@/lib/study-settings';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? '';
const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:support@passbar.app';

type ProfileRow = {
  id: string;
  study_settings: Partial<StudySettings> | null;
  exam_date: string | null;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
  profiles: ProfileRow | null;
};

function daysUntil(dateStr: string): number {
  const today = new Date();
  const examDate = new Date(dateStr);
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfExam = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
  return Math.round((startOfExam.getTime() - startOfToday.getTime()) / msPerDay);
}

/**
 * Sends push notifications for due smart reviews, daily reminders and exam countdowns.
 * Intended to be invoked hourly by Vercel Cron — `dailyReminderTime` is compared against
 * the current UTC hour (timezone-aware scheduling is not tracked per-user).
 */
export async function GET(req: NextRequest) {
  if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id, profiles(id, study_settings, exam_date)');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const subscriptions = (data ?? []) as unknown as SubscriptionRow[];
  const currentUtcHour = new Date().getUTCHours();

  let sent = 0;
  let removed = 0;

  for (const sub of subscriptions) {
    const profile = sub.profiles;
    if (!profile) continue;

    const settings = normalizeStudySettings(profile.study_settings);
    const notifications = settings.notifications;
    if (!notifications.enabled) continue;

    const messages: { title: string; body: string; url: string; tag: string }[] = [];

    if (notifications.smartReview) {
      const { data: answers } = await admin
        .from('practice_answers')
        .select('question_id, is_correct, time_spent_seconds, confidence, answered_at, question_items(chapters(id, chapter, subject))')
        .eq('user_id', sub.user_id);

      const dueChapters = getDueReviewChapters(computeChapterStats((answers ?? []) as unknown as PracticeAnswerChapterRow[]));
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
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
          removed += 1;
        } else {
          console.warn('[cron/notifications] Failed to send push:', err);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent, removed });
}
