"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, UserCheck, Clock, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/AuthProvider';
import { getAdminDb } from '@/lib/admin-client';
import { useI18n } from '@/lib/i18n';
import type { AdminUser } from '@/app/admin/users/page';

type Notification = {
  id: string;
  type: 'pending_user';
  user: AdminUser;
  createdAt: string;
};

function timeAgo(value: string | null, t: ReturnType<typeof useI18n>['t']) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 3_600_000) return t('admin.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('admin.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return t('admin.daysAgo', { count: Math.floor(diff / 86_400_000) });
}

export function NotificationBell({ variant = 'light', size = 'md' }: { variant?: 'light' | 'dark'; size?: 'sm' | 'md' }) {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const isAdmin = profile?.role === 'admin';

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const db = getAdminDb();
      if (!db) return;
      const { data } = await db.from('profiles').select('id, email, full_name, avatar_url, role, status, last_seen_at, created_at').eq('status', 'pending');
      const pending = (data ?? []) as AdminUser[];
      setNotifications(pending.map((u) => ({
        id: u.id,
        type: 'pending_user' as const,
        user: u,
        createdAt: u.created_at ?? new Date().toISOString(),
      })));
    } catch {
      // silently ignore
    }
  }, [user?.id, isAdmin]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  if (!isAdmin) return null;

  const count = notifications.length;
  const iconClass = variant === 'dark' ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-900';
  const btnSize = size === 'sm' ? 'h-8 w-8 rounded-lg hover:bg-white/10' : 'h-11 w-11 rounded-full hover:bg-black/5';
  const bellSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const badgeBg = 'bg-primary text-primary-foreground';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={`relative flex items-center justify-center transition-colors ${btnSize} ${iconClass}`}
          aria-label={t('admin.notifications')}
        >
          <Bell className={bellSize} />
          {count > 0 && (
            <span className={`absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${badgeBg}`}>
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
            notifications.map((n) => (
              <Link
                key={n.id}
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
            ))
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t px-4 py-2.5">
            <Link
              href="/admin/users?filter=pending"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t('admin.goToUserManagement')}
            </Link>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
