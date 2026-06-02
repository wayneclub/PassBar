"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, RefreshCw, LogOut, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { BrandLogo } from '@/components/BrandLogo';

type ProfileStatus = 'pending' | 'approved' | 'rejected';

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  status: ProfileStatus;
  last_seen_at: string | null;
  created_at: string | null;
};

const STATUS_LABEL: Record<ProfileStatus, string> = {
  pending: '待審核',
  approved: '已核准',
  rejected: '已拒絕',
};

const STATUS_VARIANT: Record<ProfileStatus, 'default' | 'secondary' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

function StatusIcon({ status }: { status: ProfileStatus }) {
  if (status === 'approved') return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (status === 'rejected') return <XCircle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminPage() {
  const { profile, signOut } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProfileStatus | 'all'>('all');

  const loadUsers = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, role, status, last_seen_at, created_at')
      .order('created_at', { ascending: false });

    if (!error && data) setUsers(data as UserRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function updateStatus(userId: string, status: ProfileStatus) {
    if (!supabase) return;
    setUpdating(userId);
    const { error } = await supabase
      .from('profiles')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (!error) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status } : u));
    }
    setUpdating(null);
  }

  const filtered = filter === 'all' ? users : users.filter((u) => u.status === filter);

  const counts = {
    all: users.length,
    pending: users.filter((u) => u.status === 'pending').length,
    approved: users.filter((u) => u.status === 'approved').length,
    rejected: users.filter((u) => u.status === 'rejected').length,
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandLogo />
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Shield className="h-4 w-4" />
            <span>管理後台</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{profile?.email}</span>
          <Button variant="outline" size="sm" onClick={signOut} className="gap-1.5">
            <LogOut className="h-3.5 w-3.5" />
            登出
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">使用者管理</h1>
          <Button variant="outline" size="sm" onClick={loadUsers} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            重新整理
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {f === 'all' ? '全部' : STATUS_LABEL[f]}
              <span className="ml-1.5 text-xs opacity-70">({counts[f]})</span>
            </button>
          ))}
        </div>

        {/* User table */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">沒有符合的使用者</div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">使用者</th>
                  <th className="text-left px-4 py-3 font-medium">狀態</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">最後登入</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">註冊時間</th>
                  <th className="text-right px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((user) => (
                  <tr key={user.id} className="bg-card hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.avatar_url ?? undefined} />
                          <AvatarFallback className="text-xs">
                            {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium leading-none">
                            {user.full_name ?? '—'}
                            {user.role === 'admin' && (
                              <Badge variant="outline" className="ml-2 text-xs py-0">Admin</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={user.status} />
                        <Badge variant={STATUS_VARIANT[user.status]}>
                          {STATUS_LABEL[user.status]}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {formatDate(user.last_seen_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {user.status !== 'approved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-green-600 border-green-200 hover:bg-green-50"
                            disabled={updating === user.id}
                            onClick={() => updateStatus(user.id, 'approved')}
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            核准
                          </Button>
                        )}
                        {user.status !== 'rejected' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                            disabled={updating === user.id}
                            onClick={() => updateStatus(user.id, 'rejected')}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            拒絕
                          </Button>
                        )}
                        {user.status === 'approved' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-muted-foreground"
                            disabled={updating === user.id}
                            onClick={() => updateStatus(user.id, 'pending')}
                          >
                            <Clock className="h-3.5 w-3.5" />
                            重設
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
