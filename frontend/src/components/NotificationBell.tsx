"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, UserCheck, Clock, ChevronRight, Flag, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { AdminUser } from '@/app/admin/users/page';
import type { QuestionReport } from '@/lib/question-reports';
import { fetchDueReviewChaptersForUser, type ChapterReviewInfo } from '@/lib/smart-planner';

type PendingUserNotification = {
  id: string;
  type: 'pending_user';
  user: AdminUser;
  createdAt: string;
};

type ReportNotification = {
  id: string;
  type: 'question_report';
  report: QuestionReport;
  createdAt: string;
};

type SmartReviewNotification = {
  id: string;
  type: 'smart_review';
  count: number;
  chapters: ChapterReviewInfo[];
  createdAt: string;
};

type Notification = PendingUserNotification | ReportNotification | SmartReviewNotification;

function timeAgo(value: string | null, t: ReturnType<typeof useI18n>['t']) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 3_600_000) return t('admin.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('admin.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return t('admin.daysAgo', { count: Math.floor(diff / 86_400_000) });
}

const CATEGORY_LABELS: Record<string, string> = {
  wrong_answer: '答案有誤',
  typo: '題目誤字',
  unclear: '說明不清',
  outdated: '內容過時',
  other: '其他',
};

export function NotificationBell({
  variant = 'light',
  size = 'md',
  align = 'end',
  side = 'bottom',
}: {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md';
  align?: 'start' | 'end' | 'center';
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const isAdmin = profile?.role === 'admin';

  const load = useCallback(async () => {
    if (!user?.id) return;

    let pendingUsers: Notification[] = [];
    let reports: Notification[] = [];
    let smartReviews: Notification[] = [];

    // User study notifications
    const dueChapters = await fetchDueReviewChaptersForUser(user.id);
    if (dueChapters.length > 0) {
      smartReviews = [{
        id: 'smart-review-reminder',
        type: 'smart_review',
        count: dueChapters.length,
        chapters: dueChapters,
        createdAt: new Date().toISOString(),
      }];
    }

    if (isAdmin) {
      try {
        const [pendingUsersRes, reportsRes] = await Promise.all([
          api.get<Array<{ id: string; fullName: string | null; email: string | null; createdAt: string | null }>>('/admin/pending-users?limit=50'),
          api.get<Array<{ id: string; questionId: string; userId: string | null; category: string; categories: string[] | null; language: string | null; message: string | null; resolved: boolean; resolvedAt: string | null; createdAt: string; fullName?: string | null; email?: string | null }>>('/question-reports?resolved=false&limit=50'),
        ]);

        pendingUsers = pendingUsersRes.map((u) => ({
          id: u.id,
          type: 'pending_user' as const,
          user: {
            id: u.id, email: u.email, full_name: u.fullName, avatar_url: null,
            role: 'student', status: 'pending',
            last_seen_at: null, created_at: u.createdAt,
          } as AdminUser,
          createdAt: u.createdAt ?? new Date().toISOString(),
        }));

        reports = reportsRes.map((r) => ({
          id: r.id,
          type: 'question_report' as const,
          report: {
            id: r.id, question_id: r.questionId, user_id: r.userId,
            category: r.category as QuestionReport['category'], categories: r.categories as QuestionReport['categories'],
            language: r.language, message: r.message, resolved: r.resolved, resolved_at: r.resolvedAt,
            created_at: r.createdAt, profiles: { full_name: r.fullName ?? null, email: r.email ?? null },
          },
          createdAt: r.createdAt,
        }));
      } catch (err) {
        console.warn('[PassBar] Failed to load admin notifications:', err);
      }
    }

    // Sort by createdAt descending
    const all = [...smartReviews, ...pendingUsers, ...reports].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    setNotifications(all);
  }, [isAdmin, user?.id]);

  // Initial load + periodic refresh (replaces the previous Supabase realtime
  // subscription, since admin tables are now only reachable via the backend API).
  useEffect(() => {
    load();
    const interval = setInterval(() => void load(), 60_000);
    return () => clearInterval(interval);
  }, [load]);

  // Instead of hiding the bell completely for non-admins, we only hide if no notifications
  // and they are not admin. That way the UI stays clean.
  if (!isAdmin && notifications.length === 0) return null;

  const count = notifications.length;
  const iconClass = variant === 'dark' ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-900';
  const btnSize = size === 'sm' ? 'h-8 w-8 rounded-lg hover:bg-white/10' : 'h-11 w-11 rounded-full hover:bg-black/5';
  const bellSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={`relative flex items-center justify-center transition-colors ${btnSize} ${iconClass}`}
          aria-label={t('admin.notifications')}
        >
          <Bell className={`${bellSize} ${open ? 'text-amber-500 fill-amber-500' : ''}`} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} side={side} collisionPadding={16} className="w-[calc(100vw-32px)] md:w-80 p-0" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{t('admin.notifications')}</span>
          {count > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {t('admin.unhandledCount', { count })}
            </span>
          )}
        </div>

        {/* Notifications */}
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-4 px-4 text-center">
              <Bell className="h-4 w-4 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{t('admin.noNotifications')}</p>
            </div>
          ) : (
            notifications.map((n) => {
              if (n.type === 'pending_user') {
                return (
                  <Link
                    key={`user-${n.id}`}
                    href="/admin/users?filter=pending"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 border-b last:border-0"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <UserCheck className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug">
                        {t('admin.pendingUserNotification', { name: n.user.full_name ?? n.user.email ?? t('admin.anonymous') })}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">{n.user.email}</p>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {timeAgo(n.createdAt, t)}
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                );
              }

              if (n.type === 'smart_review') {
                const chapterIds = n.chapters.map((c) => c.chapterId).join(',');
                const SHOW = 3;
                const chapterLabel = n.chapters.length <= SHOW
                  ? n.chapters.map((c) => c.chapterName).join('、')
                  : `${n.chapters.slice(0, SHOW).map((c) => c.chapterName).join('、')}...`;
                return (
                  <Link
                    key={`review-${n.id}`}
                    href={`/create?chapters=${encodeURIComponent(chapterIds)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 border-b last:border-0"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
                      <RotateCcw className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug">
                        {t('nav.smartReviewReminder', { count: n.count })}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {chapterLabel}
                      </p>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {timeAgo(n.createdAt, t)}
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                );
              }

              // question_report
              const categoryLabel = CATEGORY_LABELS[n.report.category] ?? n.report.category;
              return (
                <Link
                  key={`report-${n.id}`}
                  href="/admin/questions?tab=reports"
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 border-b last:border-0"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                    <Flag className="h-4 w-4 text-amber-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground leading-snug">
                      {t('admin.questionReportNotification', { category: categoryLabel })}
                    </p>
                    {n.report.message && (
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">{n.report.message}</p>
                    )}
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {timeAgo(n.createdAt, t)}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Link>
              );
            })
          )}
        </div>

      </DropdownMenuContent>
    </DropdownMenu>
  );
}
