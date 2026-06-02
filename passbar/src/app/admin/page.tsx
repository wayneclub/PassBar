"use client";

import React, { useEffect, useState } from 'react';
import { Users, Clock, CheckCircle, TrendingUp, Activity, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { getAdminDb } from '@/lib/admin-client';

type Stats = {
  total: number; pending: number; approved: number;
  rejected: number; activeToday: number; totalSessions: number;
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color: string;
  href?: string;
}) {
  const inner = (
    <div className="group rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className={`rounded-lg p-2.5 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, approved: 0, rejected: 0, activeToday: 0, totalSessions: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const db = getAdminDb();
      if (!db) { setLoading(false); return; }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [{ data: profiles }, { data: active }, { count: sessionCount }] = await Promise.all([
        db.from('profiles').select('status'),
        db.from('profiles').select('id').gte('last_seen_at', todayStart.toISOString()),
        db.from('practice_sessions').select('*', { count: 'exact', head: true }),
      ]);
      const rows = (profiles ?? []) as { status: string }[];
      setStats({
        total: rows.length,
        pending: rows.filter((r) => r.status === 'pending').length,
        approved: rows.filter((r) => r.status === 'approved').length,
        rejected: rows.filter((r) => r.status === 'rejected').length,
        activeToday: (active ?? []).length,
        totalSessions: sessionCount ?? 0,
      });
      setLoading(false);
    }
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-primary">數據總覽</h1>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              icon={Users}
              label="總註冊用戶"
              value={stats.total}
              color="bg-blue-50 text-blue-600"
              href="/admin/users"
            />
            <StatCard
              icon={Clock}
              label="待審核申請"
              value={stats.pending}
              sub={stats.pending > 0 ? '需要處理' : '全部處理完畢'}
              color={stats.pending > 0 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}
              href="/admin/users?filter=pending"
            />
            <StatCard
              icon={Activity}
              label="今日活躍"
              value={stats.activeToday}
              color="bg-purple-50 text-purple-600"
            />
            <StatCard
              icon={BookOpen}
              label="練習場次總數"
              value={stats.totalSessions}
              color="bg-indigo-50 text-indigo-600"
            />
          </div>

          {/* Quick actions */}
          {stats.pending > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Clock className="h-5 w-5 text-amber-600" />
                    <span className="absolute -right-1 -top-1 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      有 {stats.pending} 筆申請等待審核
                    </p>
                    <p className="text-xs text-amber-700">新用戶正在等待你的核准才能使用系統</p>
                  </div>
                </div>
                <Link
                  href="/admin/users?filter=pending"
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
                >
                  立即審核
                </Link>
              </div>
            </div>
          )}

          {/* Summary bar */}
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">用戶狀態分佈</p>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {stats.total > 0 && (
                <>
                  <div
                    className="bg-green-500 transition-all"
                    style={{ width: `${(stats.approved / stats.total) * 100}%` }}
                  />
                  <div
                    className="bg-amber-400 transition-all"
                    style={{ width: `${(stats.pending / stats.total) * 100}%` }}
                  />
                  <div
                    className="bg-red-400 transition-all"
                    style={{ width: `${(stats.rejected / stats.total) * 100}%` }}
                  />
                </>
              )}
            </div>
            <div className="mt-3 flex gap-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" />已核准 {stats.approved}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />待審核 {stats.pending}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />已拒絕 {stats.rejected}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
