import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { DB, type Database } from '../db/db.provider';
import { profiles, pushSubscriptions } from '../db/schema';
import { PlannerService } from '../attempts/planner.service';

type StudySettings = {
  notifications?: {
    enabled?: boolean;
    smartReview?: boolean;
    dailyReminder?: boolean;
    dailyReminderTime?: string;
    examCountdown?: boolean;
  };
};

function daysUntil(dateStr: string): number {
  const today = new Date();
  const examDate = new Date(dateStr);
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfExam = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
  return Math.round((startOfExam.getTime() - startOfToday.getTime()) / msPerDay);
}

@Injectable()
export class PushCronService {
  private readonly logger = new Logger(PushCronService.name);
  private vapidConfigured = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly plannerService: PlannerService,
  ) {}

  private ensureVapid() {
    if (this.vapidConfigured) return true;
    const publicKey = this.config.get<string>('NEXT_PUBLIC_VAPID_PUBLIC_KEY') ?? this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT') ?? 'mailto:support@passbar.app';
    if (!publicKey || !privateKey) return false;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.vapidConfigured = true;
    return true;
  }

  /**
   * Sends push notifications for due smart reviews, daily reminders, and exam countdowns.
   * Intended to be invoked hourly by an external cron trigger (e.g. cron-job.org, Vercel Cron)
   * hitting POST /internal/cron/notifications with the shared CRON_SECRET header.
   */
  async runHourlyNotifications() {
    if (!this.ensureVapid()) {
      this.logger.warn('VAPID keys not configured — skipping push notifications');
      return { ok: false, sent: 0, removed: 0 };
    }

    const subscriptions = await this.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        userId: pushSubscriptions.userId,
        studySettings: profiles.studySettings,
        examDate: profiles.examDate,
      })
      .from(pushSubscriptions)
      .leftJoin(profiles, eq(profiles.id, pushSubscriptions.userId));

    const currentUtcHour = new Date().getUTCHours();
    let sent = 0;
    let removed = 0;

    for (const sub of subscriptions) {
      const settings = (sub.studySettings ?? {}) as StudySettings;
      const notifications = settings.notifications;
      if (!notifications?.enabled) continue;

      const messages: { title: string; body: string; url: string; tag: string }[] = [];

      if (notifications.smartReview) {
        const dueChapters = await this.plannerService.fetchDueReviewChaptersForUser(sub.userId);
        if (dueChapters.length > 0) {
          messages.push({
            title: 'PassBar',
            body: `You have ${dueChapters.length} chapter${dueChapters.length > 1 ? 's' : ''} due for review.`,
            url: './dashboard',
            tag: 'smart-review',
          });
        }
      }

      const reminderHour = Number((notifications.dailyReminderTime ?? '20:00').split(':')[0]);
      if (notifications.dailyReminder && reminderHour === currentUtcHour) {
        messages.push({
          title: 'PassBar',
          body: "It's time for your daily study session!",
          url: './dashboard',
          tag: 'daily-reminder',
        });
      }

      if (notifications.examCountdown && sub.examDate && reminderHour === currentUtcHour) {
        const remaining = daysUntil(sub.examDate);
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
            await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
            removed += 1;
          } else {
            this.logger.warn(`Failed to send push: ${err}`);
          }
        }
      }
    }

    return { ok: true, sent, removed };
  }
}
