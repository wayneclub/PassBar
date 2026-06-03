"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, UserCheck, Clock, ChevronRight, Flag } from 'lucide-react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/AuthProvider';
import { getAdminDb } from '@/lib/admin-client';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { AdminUser } from '@/app/admin/users/page';
import type { QuestionReport } from '@/lib/question-reports';

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

type Notification = PendingUserNotification | ReportNotification;

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

export function NotificationBell({ variant = 'light', size = 'md' }: { variant?: 'light' | 'dark'; size?: 'sm' | 'md' }) {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  // Unique per component instance — prevents name collisions when multiple
  // NotificationBell components render simultaneously (e.g. sidebar + mobile header).
  const instanceId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);

  const isAdmin = profile?.role === 'admin';

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const db = getAdminDb();
    if (!db) return;

    const [profilesRes, reportsRes] = await Promise.all([
      db.from('profiles').select('id, email, full_name, avatar_url, role, status, last_seen_at, created_at').eq('status', 'pending'),
      db.from('question_reports').select('id, question_id, category, message, resolved, created_at, user_id').eq('resolved', false).order('created_at', { ascending: false }).limit(50),
    ]);

    const pendingUsers: Notification[] = ((profilesRes.data ?? []) as AdminUser[]).map((u) => ({
      id: u.id,
      type: 'pending_user' as const,
      user: u,
      createdAt: u.created_at ?? new Date().toISOString(),
    }));

    const reports: Notification[] = ((reportsRes.data ?? []) as QuestionReport[]).map((r) => ({
      id: r.id,
      type: 'question_report' as const,
      report: r,
      createdAt: r.created_at,
    }));

    // Sort by createdAt descending, pending users first
    const all = [...pendingUsers, ...reports].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    setNotifications(all);
  }, [isAdmin]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Supabase real-time subscription
  useEffect(() => {
    if (!isAdmin || !supabase) return;

    let cancelled = false;

    // Defer channel creation so StrictMode's synchronous cleanup can finish
    // before we subscribe — prevents "cannot add callbacks after subscribe()" errors.
    const timer = setTimeout(() => {
      if (cancelled || !supabase) return;

      const channel = supabase
        .channel(`admin-notifications-${instanceId.current}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: 'status=eq.pending' }, () => {
          void load();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'question_reports' }, () => {
          void load();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'question_reports' }, () => {
          void load();
        })
        .subscribe();

      channelRef.current = channel;
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channelRef.current && supabase) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      // Rotate the instance ID so the next subscription gets a fresh channel name.
      instanceId.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    };
  }, [isAdmin, load]);

  if (!isAdmin) return null;

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
          <Bell className={bellSize} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0" sideOffset={8}>
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
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/40" />
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

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t px-4 py-2.5 flex items-center justify-between">
            <Link
              href="/admin/users?filter=pending"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t('admin.goToUserManagement')}
            </Link>
            <Link
              href="/admin/questions?tab=reports"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t('admin.goToReports')}
            </Link>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
