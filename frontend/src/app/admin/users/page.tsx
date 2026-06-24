"use client";

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Check, X, Clock, RefreshCw, Search,
  MoreHorizontal, UserCheck, UserX, RotateCcw, History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { InterfaceLanguage } from '@/lib/study-settings';

type ProfileStatus = 'pending' | 'approved' | 'rejected';
type FilterType = 'all' | ProfileStatus;
export type AdminUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  status: ProfileStatus;
  last_seen_at: string | null;
  created_at: string | null;
};
type UserRow = AdminUser;

const STATUS_META: Record<ProfileStatus, { labelKey: string; dot: string; badge: string }> = {
  pending:  { labelKey: 'admin.statusPending', dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { labelKey: 'admin.statusApproved', dot: 'bg-green-500', badge: 'bg-green-50 text-green-700 border-green-200' },
  rejected: { labelKey: 'admin.statusRejected', dot: 'bg-red-400',  badge: 'bg-red-50 text-red-700 border-red-200' },
};

function StatusBadge({ status, t }: { status: ProfileStatus; t: ReturnType<typeof useI18n>['t'] }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${m.badge}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot} ${status === 'pending' ? 'animate-pulse' : ''}`} />
      {t(m.labelKey)}
    </span>
  );
}

type LoginHistoryEntry = {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  ip: string | null;
  userAgent: string | null;
};
type LoginHistoryResponse = { sessions: LoginHistoryEntry[]; loginCount: number };

function LoginHistoryDialog({
  userId, userLabel, onClose, t, language,
}: {
  userId: string;
  userLabel: string;
  onClose: () => void;
  t: ReturnType<typeof useI18n>['t'];
  language: InterfaceLanguage;
}) {
  const [data, setData] = useState<LoginHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<LoginHistoryResponse>(`/admin/users/${userId}/login-history`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setError(t('admin.loginHistoryError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-[28rem] max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-slate-50 border-b px-6 py-4">
          <h2 className="text-base font-semibold">{t('admin.loginHistoryTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{userLabel}</p>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !data || data.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.noLoginHistory')}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t('admin.loginCount')}: <span className="font-semibold text-foreground">{data.loginCount}</span>
              </p>
              <ul className="space-y-2">
                {data.sessions.map((s) => (
                  <li key={s.id} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{formatDate(s.createdAt, language, t)}</span>
                      <Badge
                        variant="outline"
                        className={s.revokedAt
                          ? 'border-slate-200 text-slate-500'
                          : 'border-green-200 bg-green-50 text-green-700'}
                      >
                        {s.revokedAt ? t('admin.status_loggedOut') : t('admin.status_active')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('admin.ipAddress')}: {s.ip ?? '—'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={s.userAgent ?? undefined}>
                      {t('admin.device')}: {s.userAgent ?? '—'}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="border-t px-6 py-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>{t('admin.close')}</Button>
        </div>
      </div>
    </div>
  );
}

function formatDate(v: string | null, language: InterfaceLanguage, t: ReturnType<typeof useI18n>['t']) {
  if (!v) return '—';
  const d = new Date(v);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return t('admin.justNow');
  if (diff < 3_600_000) return t('admin.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('admin.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return d.toLocaleDateString(language === 'en' ? 'en-US' : language, { month: 'short', day: 'numeric', year: 'numeric' });
}

function AdminUsersContent() {
  const { t, language } = useI18n();
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('filter') as FilterType) ?? 'all';
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>(initialFilter);
  const [search, setSearch] = useState('');
  const [historyTarget, setHistoryTarget] = useState<UserRow | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<Array<{
        id: string; email: string | null; fullName: string | null; avatarUrl: string | null;
        role: string; status: ProfileStatus; lastSeenAt: string | null; createdAt: string | null;
      }>>('/admin/users');
      setUsers(rows.map((r) => ({
        id: r.id, email: r.email, full_name: r.fullName, avatar_url: r.avatarUrl,
        role: r.role, status: r.status, last_seen_at: r.lastSeenAt, created_at: r.createdAt,
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function doUpdateStatus(userId: string, status: ProfileStatus) {
    setUpdating(userId);
    try {
      await api.patch(`/admin/users/${userId}/status`, { status });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status } : u));
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(null);
    }
  }

  const counts = {
    all: users.length,
    pending: users.filter((u) => u.status === 'pending').length,
    approved: users.filter((u) => u.status === 'approved').length,
    rejected: users.filter((u) => u.status === 'rejected').length,
  };

  const filtered = users
    .filter((u) => filter === 'all' || u.status === filter)
    .filter((u) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (u.email ?? '').toLowerCase().includes(q) || (u.full_name ?? '').toLowerCase().includes(q);
    });

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: 'all',      label: t('admin.filterAll', { count: counts.all }) },
    { key: 'pending',  label: t('admin.filterPending', { count: counts.pending }) },
    { key: 'approved', label: t('admin.filterApproved', { count: counts.approved }) },
    { key: 'rejected', label: t('admin.filterRejected', { count: counts.rejected }) },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-primary">{t('admin.usersTitle')}</h1>
        <Button variant="outline" size="sm" onClick={loadUsers} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          {t('admin.refresh')}
        </Button>
      </div>

      {/* Pending alert */}
      {counts.pending > 0 && (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t('admin.pendingUsersTitle', { count: counts.pending })}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('admin.pendingUsersDescription')}</p>
          </div>
          <button
            onClick={() => setFilter('pending')}
            className="shrink-0 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t('admin.viewApplications')}
          </button>
        </div>
      )}

      {/* Filter + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${
                filter === f.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('admin.searchUsersPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive">
          ⚠️ {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            {search ? t('admin.noMatchingUsers', { search }) : t('admin.noFilteredUsers')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">{t('admin.user')}</th>
                <th className="px-5 py-3 text-left font-medium">{t('admin.status')}</th>
                <th className="hidden px-5 py-3 text-left font-medium md:table-cell">{t('admin.lastActive')}</th>
                <th className="hidden px-5 py-3 text-left font-medium lg:table-cell">{t('admin.joinedAt')}</th>
                <th className="px-5 py-3 text-right font-medium">{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((user) => {
                const initials = ((user.full_name ?? user.email ?? '?')[0]).toUpperCase();
                const isPending = user.status === 'pending';
                const isEduEmail = (user.email ?? '').endsWith('.edu.tw') || (user.email ?? '').endsWith('.edu');
                return (
                  <tr
                    key={user.id}
                    className={`transition-colors hover:bg-muted/30 ${isPending ? 'bg-amber-50/40' : ''}`}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border">
                          <AvatarImage src={user.avatar_url ?? undefined} />
                          <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            {user.full_name ?? <span className="text-muted-foreground italic">{t('admin.notProvided')}</span>}
                            {user.role === 'admin' && (
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 text-[10px] py-0">
                                Admin
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {user.email}
                            {isEduEmail && (
                              <span className="rounded bg-blue-100 px-1 text-[10px] text-blue-600">EDU</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <StatusBadge status={user.status} t={t} />
                    </td>

                    <td className="hidden px-5 py-4 text-muted-foreground md:table-cell">
                      {formatDate(user.last_seen_at, language, t)}
                    </td>

                    <td className="hidden px-5 py-4 text-muted-foreground lg:table-cell">
                      {formatDate(user.created_at, language, t)}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Pending: approve + reject inline */}
                        {isPending && (
                          <>
                            <button
                              disabled={updating === user.id}
                              onClick={() => doUpdateStatus(user.id, 'approved')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              {t('admin.approve')}
                            </button>
                            <button
                              disabled={updating === user.id}
                              onClick={() => doUpdateStatus(user.id, 'rejected')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                            >
                              <UserX className="h-3.5 w-3.5" />
                              {t('admin.reject')}
                            </button>
                          </>
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              disabled={updating === user.id}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            {user.status !== 'approved' && (
                              <DropdownMenuItem
                                onClick={() => doUpdateStatus(user.id, 'approved')}
                                className="gap-2.5 text-green-700 focus:text-green-700"
                              >
                                <Check className="h-3.5 w-3.5" />
                                {t('admin.approveAccount')}
                              </DropdownMenuItem>
                            )}
                            {user.status !== 'rejected' && (
                              <DropdownMenuItem
                                onClick={() => doUpdateStatus(user.id, 'rejected')}
                                className="gap-2.5 text-destructive focus:text-destructive"
                              >
                                <X className="h-3.5 w-3.5" />
                                {t('admin.rejectAccount')}
                              </DropdownMenuItem>
                            )}
                            {user.status !== 'pending' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => doUpdateStatus(user.id, 'pending')}
                                  className="gap-2.5 text-muted-foreground"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  {t('admin.resetPending')}
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setHistoryTarget(user)}
                              className="gap-2.5 text-muted-foreground"
                            >
                              <History className="h-3.5 w-3.5" />
                              {t('admin.viewLoginHistory')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-right text-xs text-muted-foreground">
          {t('admin.showingUsers', { shown: filtered.length, total: users.length })}
        </p>
      )}

      {historyTarget && (
        <LoginHistoryDialog
          userId={historyTarget.id}
          userLabel={historyTarget.full_name ?? historyTarget.email ?? historyTarget.id}
          onClose={() => setHistoryTarget(null)}
          t={t}
          language={language}
        />
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    }>
      <AdminUsersContent />
    </Suspense>
  );
}
