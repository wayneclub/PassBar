"use client";

import React, { useEffect, useState } from 'react';
import {
  Users, Clock, Activity, BookOpen, Flag,
  CheckCircle, XCircle, ChevronRight, Check,
} from 'lucide-react';
import Link from 'next/link';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { getAdminDb } from '@/lib/admin-client';
import { getQuestionReports, resolveQuestionReport, QuestionReport, REPORT_CATEGORIES } from '@/lib/question-reports';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

/* ─── Types ─── */
type DayRow = { date: string; dau: number; answers: number };
type Stats = {
  total: number; pending: number; approved: number; rejected: number;
  activeToday: number; totalAnswers: number; unresolvedReports: number;
};
type PendingUser = { id: string; full_name: string | null; email: string | null; created_at: string };
type CompletionRow = { name: string; value: number; color: string };
type BrowserRow = { browser: string; count: number };
type OsRow = { os: string; count: number };

/* ─── Helpers ─── */
function fmtDate(d: string) {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function parseBrowser(ua: string | null, t: ReturnType<typeof useI18n>['t']): string {
  if (!ua) return t('admin.unknown');
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const suffix = isMobile ? ' (Mobile)' : ' (Desktop)';
  // Check most-specific first to avoid misclassification
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Browser' + suffix;
  if (/OPR\/|Opera\//i.test(ua))    return 'Opera' + suffix;
  if (/Edg\//i.test(ua))            return 'Edge' + suffix;
  if (/Firefox\//i.test(ua))        return 'Firefox' + suffix;
  if (/Chromium\//i.test(ua))       return 'Chromium' + suffix;
  if (/CriOS\//i.test(ua))          return 'Chrome (iOS)';
  if (/FxiOS\//i.test(ua))          return 'Firefox (iOS)';
  // Brave doesn't add itself to UA, but exposes navigator.brave — we can only detect
  // via the Sec-CH-UA header (not available server-side). Best effort: Brave UA is
  // identical to Chrome, so tag it as Chrome (Chromium-based).
  if (/Chrome\/\d/i.test(ua))       return 'Chrome / Brave (Chromium)' + suffix;
  if (/Safari\//i.test(ua))         return isMobile ? 'Safari (iOS)' : 'Safari (Desktop)';
  return t('admin.other');
}

function parseOS(ua: string | null, t: ReturnType<typeof useI18n>['t']): string {
  if (!ua) return t('admin.unknown');
  if (/iPhone/i.test(ua))                   return 'iOS (iPhone)';
  if (/iPad/i.test(ua))                     return 'iOS (iPad)';
  if (/Android/i.test(ua))                  return 'Android';
  if (/Windows NT 10/i.test(ua))            return 'Windows 10/11';
  if (/Windows NT/i.test(ua))               return t('admin.windowsLegacy');
  if (/Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua))                    return 'Linux';
  if (/CrOS/i.test(ua))                     return 'ChromeOS';
  return t('admin.other');
}

function categoryLabel(cat: string) {
  return REPORT_CATEGORIES.find(c => c.value === cat)?.label ?? cat;
}

function reportCategoryLabels(r: { category: string; categories: string[] | null }) {
  const cats = r.categories && r.categories.length > 0 ? r.categories : [r.category];
  return cats.map(categoryLabel).join('、');
}

/* ─── Sub-components ─── */
function StatCard({ icon: Icon, label, value, sub, accent, href }: {
  icon: React.ElementType; label: string; value: number | string;
  sub?: string; accent: string; href?: string;
}) {
  const inner = (
    <div className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className={cn('rounded-xl p-2', accent)}><Icon className="h-4 w-4" /></div>
      </div>
      <p className="text-3xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

const CHART_GOLD = '#C59B27';

/* ─── Main ─── */
export default function AdminDashboardPage() {
  const { t, language } = useI18n();
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, approved: 0, rejected: 0, activeToday: 0, totalAnswers: 0, unresolvedReports: 0 });
  const [trend, setTrend] = useState<DayRow[]>([]);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [completion, setCompletion] = useState<CompletionRow[]>([]);
  const [browsers, setBrowsers] = useState<BrowserRow[]>([]);
  const [osRows, setOsRows] = useState<OsRow[]>([]);
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<7 | 30>(7);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const db = getAdminDb();
      if (!db) { setLoading(false); return; }

      const since = new Date();
      since.setDate(since.getDate() - range);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const staleThreshold = new Date(); staleThreshold.setDate(staleThreshold.getDate() - 1);

      const [
        { data: profiles },
        { data: active },
        { data: sessions },
        { data: pendingList },
        reportRows,
      ] = await Promise.all([
        db.from('profiles').select('status'),
        db.from('profiles').select('id').gte('last_seen_at', todayStart.toISOString()),
        db.from('practice_sessions').select('started_at, question_count, status, user_agent, completed_at').gte('started_at', since.toISOString()).order('started_at'),
        db.from('profiles').select('id, full_name, email, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
        getQuestionReports({ limit: 20 }),
      ]);

      const rows = (profiles ?? []) as { status: string }[];
      const sessionRows = (sessions ?? []) as {
        started_at: string; question_count: number; status: string;
        user_agent: string | null; completed_at: string | null;
      }[];

      // Daily trend buckets
      const buckets: Record<string, { answers: number }> = {};
      for (let i = range - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        buckets[d.toISOString().slice(0, 10)] = { answers: 0 };
      }
      for (const s of sessionRows) {
        const day = s.started_at.slice(0, 10);
        if (buckets[day]) buckets[day].answers += s.question_count ?? 0;
      }
      const trendData: DayRow[] = Object.entries(buckets).map(([date, v]) => ({
        date: fmtDate(date), dau: 0, answers: v.answers,
      }));

      // Session completion
      let completed = 0, abandoned = 0, crashed = 0;
      for (const s of sessionRows) {
        if (s.status === 'completed') completed++;
        else if (s.status === 'suspended') abandoned++;
        else crashed++;
      }
      const completionData: CompletionRow[] = [
        { name: t('admin.completionCompleted'), value: completed, color: '#4ade80' },
        { name: t('admin.completionSuspended'), value: abandoned, color: '#fbbf24' },
        { name: t('admin.completionCrashed'), value: crashed, color: '#f87171' },
      ].filter(d => d.value > 0);

      // Browser & OS distribution
      const browserMap: Record<string, number> = {};
      const osMap: Record<string, number> = {};
      for (const s of sessionRows) {
        const b = parseBrowser(s.user_agent, t);
        browserMap[b] = (browserMap[b] ?? 0) + 1;
        const o = parseOS(s.user_agent, t);
        osMap[o] = (osMap[o] ?? 0) + 1;
      }
      const browserData: BrowserRow[] = Object.entries(browserMap)
        .sort((a, b) => b[1] - a[1])
        .map(([browser, count]) => ({ browser, count }));
      const osData: OsRow[] = Object.entries(osMap)
        .sort((a, b) => b[1] - a[1])
        .map(([os, count]) => ({ os, count }));

      const unresolvedReports = reportRows.filter(r => !r.resolved).length;

      setStats({
        total: rows.length,
        pending: rows.filter(r => r.status === 'pending').length,
        approved: rows.filter(r => r.status === 'approved').length,
        rejected: rows.filter(r => r.status === 'rejected').length,
        activeToday: (active ?? []).length,
        totalAnswers: sessionRows.reduce((acc, s) => acc + (s.question_count ?? 0), 0),
        unresolvedReports,
      });
      setTrend(trendData);
      setPendingUsers((pendingList ?? []) as PendingUser[]);
      setCompletion(completionData);
      setBrowsers(browserData);
      setOsRows(osData);
      setReports(reportRows);
      setLoading(false);
    }
    load().catch(console.error);
  }, [range, language, t]);

  const handleResolve = async (reportId: string) => {
    await resolveQuestionReport(reportId);
    setReports(prev => prev.map(r => r.id === reportId ? { ...r, resolved: true, resolved_at: new Date().toISOString() } : r));
  };

  const maxBrowserCount = Math.max(...browsers.map(b => b.count), 1);

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-3xl font-bold text-primary">{t('admin.dashboardTitle')}</h1>
        <div className="flex gap-2 self-start rounded-lg border border-border bg-card p-1">
          {([7, 30] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={cn('rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                range === r ? 'bg-secondary text-white' : 'text-muted-foreground hover:text-foreground')}>
              {t('admin.lastDays', { days: r })}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard icon={Users} label={t('admin.totalUsers')} value={stats.total}
              sub={t('admin.authHealthy')} accent="bg-blue-50 text-blue-600" href="/admin/users" />
            <StatCard icon={Clock} label={t('admin.pendingApplications')}
              value={stats.pending}
              sub={stats.pending > 0 ? t('admin.pendingNeedsReview') : t('admin.allHandled')}
              accent={stats.pending > 0 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}
              href="/admin/users?filter=pending" />
            <StatCard icon={BookOpen} label={t('admin.totalAnswers')} value={stats.totalAnswers}
              sub={t('admin.databaseTotal')} accent="bg-indigo-50 text-indigo-600" href="/admin/questions" />
            <StatCard icon={Activity} label={t('admin.activeToday')} value={stats.activeToday}
              sub={t('admin.activityStable')} accent="bg-amber-50 text-amber-600" />
          </div>

          {/* Pending users alert */}
          {stats.pending > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
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
                    <p className="text-sm font-semibold text-amber-900">{t('admin.pendingAlertTitle', { count: stats.pending })}</p>
                    <p className="text-xs text-amber-700">{t('admin.pendingAlertDescription')}</p>
                  </div>
                </div>
                <Link href="/admin/users?filter=pending"
                  className="flex items-center gap-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition-colors">
                  {t('admin.reviewNow')} <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              {pendingUsers.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-amber-200 pt-4">
                  {pendingUsers.map(u => (
                    <div key={u.id} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium text-amber-900">{u.full_name || '—'}</span>
                        <span className="ml-2 text-amber-700">{u.email}</span>
                      </div>
                      <span className="text-xs text-amber-600">{new Date(u.created_at).toLocaleDateString(language === 'en' ? 'en-US' : language)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Trend + Completion row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
            {/* Trend chart */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="font-semibold text-foreground">{t('admin.trendTitle')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.trendDescription')}</p>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />{t('admin.dau')}</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-200" />{t('admin.dailyAnswers')}</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Bar yAxisId="right" dataKey="answers" fill="#e2e8f0" radius={[3, 3, 0, 0]} name={t('admin.dailyAnswers')} />
                  <Line yAxisId="left" type="monotone" dataKey="dau" stroke={CHART_GOLD} strokeWidth={2.5} dot={{ r: 3, fill: CHART_GOLD }} name={t('admin.dau')} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Completion donut */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="font-semibold text-foreground">{t('admin.completionTitle')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.completionDescription')}</p>
              {completion.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={completion} cx="50%" cy="50%" innerRadius={45} outerRadius={68}
                        dataKey="value" paddingAngle={3}>
                        {completion.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1.5">
                    {completion.map(item => (
                      <div key={item.name} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                          {item.name}
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  {completion.find(c => c.name === t('admin.completionCrashed') && c.value > 0) && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('admin.invalidExitHint')}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-10 text-center text-sm text-muted-foreground">{t('admin.noPracticeInRange')}</p>
              )}
            </div>
          </div>

          {/* Browser + OS distribution + Reports log row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
            {/* Browser + OS distribution */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="h-3 w-1 rounded-full bg-primary" />
                  <p className="font-semibold text-foreground">{t('admin.browserDistribution')}</p>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">{t('admin.browserDescription')}</p>
                {browsers.length > 0 ? (
                  <div className="space-y-2.5">
                    {browsers.map(b => (
                      <div key={b.browser}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-600">{b.browser}</span>
                          <span className="tabular-nums text-muted-foreground">{b.count}</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-primary/70 transition-all"
                            style={{ width: `${(b.count / maxBrowserCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-sm text-muted-foreground">{t('admin.noData')}</p>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="h-3 w-1 rounded-full bg-blue-400" />
                  <p className="font-semibold text-foreground">{t('admin.osDistribution')}</p>
                </div>
                {osRows.length > 0 ? (() => {
                  const maxOs = Math.max(...osRows.map(o => o.count), 1);
                  return (
                    <div className="space-y-2.5">
                      {osRows.map(o => (
                        <div key={o.os}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-slate-600">{o.os}</span>
                            <span className="tabular-nums text-muted-foreground">{o.count}</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-100">
                            <div
                              className="h-2 rounded-full bg-blue-400/70 transition-all"
                              style={{ width: `${(o.count / maxOs) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })() : (
                  <p className="text-center text-sm text-muted-foreground">{t('admin.noData')}</p>
                )}
                <p className="pt-2 text-xs text-muted-foreground">
                  {t('admin.deviceHint')}
                </p>
              </div>
            </div>

            {/* Reports log */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-1 rounded-full bg-red-500" />
                  <p className="font-semibold text-foreground">{t('admin.reportsTitle')}</p>
                </div>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">{t('admin.reportsDescription')}</p>

              {reports.length === 0 ? (
                <p className="mt-6 text-center text-sm text-muted-foreground">{t('admin.noReports')}</p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {reports.map(r => (
                    <div key={r.id}
                      className={cn('rounded-xl border p-4 text-sm transition-colors',
                        r.resolved ? 'border-slate-100 bg-slate-50' : 'border-amber-100 bg-amber-50/60')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <Flag className={cn('mt-0.5 h-4 w-4 shrink-0', r.resolved ? 'text-slate-400' : 'text-amber-500')} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-800">QID #{r.question_id.slice(-6)}</span>
                              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
                                r.resolved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                                {reportCategoryLabels(r)}
                              </span>
                              {r.language && (
                                <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-500">
                                  {r.language}
                                </span>
                              )}
                            </div>
                            {r.message && (
                              <p className="mt-1 text-xs text-slate-600 line-clamp-2">{r.message}</p>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span>{r.profiles?.full_name || r.profiles?.email || t('admin.anonymous')}</span>
                              <span>·</span>
                              <span>{new Date(r.created_at).toLocaleDateString(language === 'en' ? 'en-US' : language)}</span>
                              {r.resolved && r.resolved_at && (
                                <>
                                  <span>·</span>
                                  <span className="text-green-600">{t('admin.resolvedAt', { date: new Date(r.resolved_at).toLocaleDateString(language === 'en' ? 'en-US' : language) })}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {!r.resolved && (
                          <button
                            onClick={() => handleResolve(r.id)}
                            className="flex shrink-0 items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600 transition-colors">
                            <Check className="h-3.5 w-3.5" />
                            {t('admin.markResolved')}
                          </button>
                        )}
                        {r.resolved && (
                          <span className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500">
                            <CheckCircle className="h-3.5 w-3.5" />
                            {t('admin.resolved')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* User status distribution bar */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold text-foreground">{t('admin.userStatusDistribution')}</p>
            </div>
            {stats.total > 0 ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  <div className="bg-green-500 transition-all" style={{ width: `${(stats.approved / stats.total) * 100}%` }} />
                  <div className="bg-amber-400 transition-all" style={{ width: `${(stats.pending / stats.total) * 100}%` }} />
                  <div className="bg-red-400 transition-all" style={{ width: `${(stats.rejected / stats.total) * 100}%` }} />
                </div>
                <div className="mt-3 flex gap-5 text-xs text-muted-foreground">
                  {[
                    { label: t('admin.statusApproved'), value: stats.approved, color: 'bg-green-500', icon: CheckCircle },
                    { label: t('admin.statusPending'), value: stats.pending, color: 'bg-amber-400', icon: Clock },
                    { label: t('admin.statusRejected'), value: stats.rejected, color: 'bg-red-400', icon: XCircle },
                  ].map(({ label, value, color, icon: Icon }) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', color)} />
                      {label} {value}
                      <span className="text-slate-400">({stats.total > 0 ? Math.round((value / stats.total) * 100) : 0}%)</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground">{t('admin.noUsers')}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
