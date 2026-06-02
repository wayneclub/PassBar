"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Check, X, Clock, RefreshCw, Search,
  MoreHorizontal, UserCheck, UserX, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/AuthProvider';
import { fetchAdminUsers, updateUserStatus, type AdminUser } from '@/lib/admin-api';

type ProfileStatus = 'pending' | 'approved' | 'rejected';
type FilterType = 'all' | ProfileStatus;
type UserRow = AdminUser;

const STATUS_META: Record<ProfileStatus, { label: string; dot: string; badge: string }> = {
  pending:  { label: '待審核', dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: '已核准', dot: 'bg-green-500', badge: 'bg-green-50 text-green-700 border-green-200' },
  rejected: { label: '已拒絕', dot: 'bg-red-400',  badge: 'bg-red-50 text-red-700 border-red-200' },
};

function StatusBadge({ status }: { status: ProfileStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${m.badge}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot} ${status === 'pending' ? 'animate-pulse' : ''}`} />
      {m.label}
    </span>
  );
}

function formatDate(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return '剛才';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminUsersPage() {
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('filter') as FilterType) ?? 'all';
  const { user } = useAuth();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>(initialFilter);
  const [search, setSearch] = useState('');

  const loadUsers = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      setError(null);
      const data = await fetchAdminUsers(user.id);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function doUpdateStatus(userId: string, status: ProfileStatus) {
    if (!user?.id) return;
    setUpdating(userId);
    try {
      await updateUserStatus(user.id, userId, status);
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
    { key: 'all',      label: `全部 (${counts.all})` },
    { key: 'pending',  label: `待審核 (${counts.pending})` },
    { key: 'approved', label: `已核准 (${counts.approved})` },
    { key: 'rejected', label: `已拒絕 (${counts.rejected})` },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-primary">使用者管理</h1>
        <Button variant="outline" size="sm" onClick={loadUsers} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          重新整理
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
              {counts.pending} 位用戶等待審核
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">核准後才能使用系統</p>
          </div>
          <button
            onClick={() => setFilter('pending')}
            className="shrink-0 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            查看申請
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
            placeholder="搜尋姓名或 Email..."
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
            {search ? `找不到「${search}」相關用戶` : '沒有符合條件的用戶'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">使用者</th>
                <th className="px-5 py-3 text-left font-medium">狀態</th>
                <th className="hidden px-5 py-3 text-left font-medium md:table-cell">最後活躍</th>
                <th className="hidden px-5 py-3 text-left font-medium lg:table-cell">加入時間</th>
                <th className="px-5 py-3 text-right font-medium">操作</th>
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
                            {user.full_name ?? <span className="text-muted-foreground italic">未填寫</span>}
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
                      <StatusBadge status={user.status} />
                    </td>

                    <td className="hidden px-5 py-4 text-muted-foreground md:table-cell">
                      {formatDate(user.last_seen_at)}
                    </td>

                    <td className="hidden px-5 py-4 text-muted-foreground lg:table-cell">
                      {formatDate(user.created_at)}
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
                              核准
                            </button>
                            <button
                              disabled={updating === user.id}
                              onClick={() => doUpdateStatus(user.id, 'rejected')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                            >
                              <UserX className="h-3.5 w-3.5" />
                              拒絕
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
                                核准帳號
                              </DropdownMenuItem>
                            )}
                            {user.status !== 'rejected' && (
                              <DropdownMenuItem
                                onClick={() => doUpdateStatus(user.id, 'rejected')}
                                className="gap-2.5 text-destructive focus:text-destructive"
                              >
                                <X className="h-3.5 w-3.5" />
                                拒絕帳號
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
                                  重設為待審核
                                </DropdownMenuItem>
                              </>
                            )}
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
          顯示 {filtered.length} / {users.length} 位用戶
        </p>
      )}
    </div>
  );
}
