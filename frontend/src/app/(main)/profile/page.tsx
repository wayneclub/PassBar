"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Badge as AchievementBadge, BADGES, evaluateUserBadges, AchievementData } from '@/lib/achievements';
import {
  Flame,
  Trophy,
  Coffee,
  RotateCcw,
  CheckCircle2,
  Flag,
  BookOpen,
  Award,
  Medal,
  Star,
  Zap,
  Loader2,
  Pencil,
  Lock,
  LogOut,
  CalendarDays,
  Link as LinkIcon,
  Check
} from 'lucide-react';
import { api } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditDisplayNameDialog } from '@/components/EditDisplayNameDialog';
import { defaultStudySettings, normalizeStudySettings, saveStudySettings } from '@/lib/study-settings';
import { saveUserStudySettings } from '@/lib/user-settings';

// Map icon names to components
const IconMap: Record<string, React.ElementType> = {
  Flame,
  Trophy,
  Coffee,
  RotateCcw,
  CheckCircle2,
  Flag,
  BookOpen,
};

export default function ProfilePage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<{ badge: AchievementBadge; unlocked: boolean; progress?: { current: number; total: number } }[]>([]);
  const [stats, setStats] = useState({ totalSolved: 0, streakDays: 0, joinDate: '' });
  const [selectedTitle, setSelectedTitle] = useState<string>(t('profile.defaultTitle'));
  const [copied, setCopied] = useState(false);
  const [calendarToken, setCalendarToken] = useState<string | null>(null);

  useEffect(() => {
    const saved = profile?.study_settings?.selectedTitle;
    setSelectedTitle(saved || t('profile.defaultTitle'));
  }, [profile, t]);

  useEffect(() => {
    if (!user) return;
    api.get<{ token: string }>('/auth/calendar-token')
      .then((res) => setCalendarToken(res.token))
      .catch(() => setCalendarToken(null));
  }, [user]);

  const handleTitleChange = (title: string) => {
    setSelectedTitle(title);
    if (!user?.id) return;
    const updatedSettings = normalizeStudySettings({
      ...(profile?.study_settings ?? defaultStudySettings),
      selectedTitle: title,
    });
    saveStudySettings(updatedSettings);
    void saveUserStudySettings(user.id, updatedSettings).then(() => refreshProfile());
  };

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const data = await api.get<{
        totalSolved: number;
        streakDays: number;
        maxDailyStudySeconds: number;
        subjectPerformance: Array<{ name: string; score: number; correct: number; total: number }>;
        chapterStats: Array<{ totalAttempts: number; lastAccuracy: number | null }>;
        joinDate: string | null;
      }>('/attempts/dashboard/profile-stats');

      const achievementData: AchievementData = {
        streakDays: data.streakDays,
        maxDailyStudySeconds: data.maxDailyStudySeconds,
        chapterStats: data.chapterStats as any,
        subjectPerformance: data.subjectPerformance,
      };

      const unlockedBadges = await evaluateUserBadges(user!.id, achievementData);
      const unlockedIds = new Set(unlockedBadges.map(b => b.id));

      const badgesWithStatus = BADGES.map(badge => {
        return {
          badge,
          unlocked: unlockedIds.has(badge.id),
          progress: badge.getProgress ? badge.getProgress(achievementData) : undefined
        };
      });

      setBadges(badgesWithStatus);
      setStats({
        totalSolved: data.totalSolved,
        streakDays: data.streakDays,
        joinDate: data.joinDate ? new Date(data.joinDate).toLocaleDateString() : (profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : 'Recently'),
      });

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const unlockedTitles = [t('profile.defaultTitle'), ...badges.filter(b => b.unlocked).map(b => t(b.badge.titleKey as any))];

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL
    ? (process.env.NEXT_PUBLIC_API_URL.endsWith('/api') ? process.env.NEXT_PUBLIC_API_URL : `${process.env.NEXT_PUBLIC_API_URL}/api`)
    : (typeof window !== 'undefined' ? `${window.location.origin}/api` : '');
  const feedUrl = calendarToken ? `${apiBaseUrl}/calendar/feed?token=${calendarToken}` : '';

  const handleCopy = () => {
    if (!feedUrl) return;
    navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('settings.profile' as any)}</h1>
          <p className="text-muted-foreground mt-2">{t('profile.subtitle')}</p>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 hover:text-red-700 transition-colors shadow-sm"
        >
          <LogOut className="w-4 h-4" />
          {t('auth.signOut' as any)}
        </button>
      </header>

      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-secondary to-slate-800 text-secondary-foreground shadow-xl">
        <div className="absolute inset-0 bg-white/5 [mask-image:linear-gradient(to_bottom,white,transparent)]" />
        <div className="relative p-6 sm:p-8 md:p-12 flex flex-col md:flex-row md:items-center flex-wrap gap-6 md:gap-8">
          <div className="h-24 w-24 rounded-full bg-white/20 p-1 flex-shrink-0 backdrop-blur-md shadow-inner mx-auto md:mx-0 transition-transform duration-300 hover:scale-105 hover:rotate-3">
            <div className="h-full w-full rounded-full bg-primary flex items-center justify-center text-4xl font-bold">
              {profile?.full_name?.charAt(0).toUpperCase() || 'P'}
            </div>
          </div>
          <div className="text-center md:text-left flex-1 min-w-0">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <h2 className="text-3xl font-bold truncate">{profile?.full_name || t('profile.candidateName')}</h2>
              <EditDisplayNameDialog>
                <button type="button" className="shrink-0 rounded p-1 text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
              </EditDisplayNameDialog>
            </div>
            <div className="flex items-center justify-center md:justify-start gap-2 mt-2">
              <Select value={selectedTitle} onValueChange={handleTitleChange}>
                <SelectTrigger className="w-full max-w-[200px] bg-white/10 border-white/20 text-primary-foreground transition-colors hover:bg-white/15 hover:border-white/30 focus:ring-white">
                  <SelectValue placeholder={t('profile.selectTitle')} />
                </SelectTrigger>
                <SelectContent>
                  {unlockedTitles.map(title => (
                    <SelectItem key={title} value={title}>{title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="mt-4 text-primary-foreground/80 font-medium">
              {stats.joinDate ? t('profile.joined', { date: stats.joinDate }) : t('profile.recently')}
            </p>
          </div>
          <div className="flex gap-6 justify-center shrink-0">
            <div className="text-center group">
              <div className="text-3xl font-bold flex items-center gap-2 justify-center">
                {stats.streakDays}
                <span className="rounded-full bg-orange-400/15 p-1.5 transition-transform duration-300 group-hover:scale-110 group-hover:bg-orange-400/25">
                  <Flame className="w-5 h-5 text-orange-400" />
                </span>
              </div>
              <div className="text-xs uppercase tracking-wider text-primary-foreground/80 mt-1">{t('profile.dayStreak')}</div>
            </div>
            <div className="w-px bg-white/20" />
            <div className="text-center group">
              <div className="text-3xl font-bold flex items-center gap-2 justify-center">
                {stats.totalSolved}
                <span className="rounded-full bg-emerald-400/15 p-1.5 transition-transform duration-300 group-hover:scale-110 group-hover:bg-emerald-400/25">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </span>
              </div>
              <div className="text-xs uppercase tracking-wider text-primary-foreground/80 mt-1">{t('profile.qsSolved')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Subscription Section */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold tracking-tight">{t('profile.subscribePlan' as any) || 'Subscribe to Study Plan'}</h2>
        </div>
        
        <Card className="border-primary/20 bg-gradient-to-br from-white to-primary/5 shadow-sm">
          <CardHeader>
            <CardDescription className="text-base text-slate-600">
              {t('profile.subscribePlanDesc' as any) || 'Sync your daily tasks to your favorite calendar app.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-center">
              <a
                href={feedUrl ? `webcal://${feedUrl.replace(/^https?:\/\//, '')}` : '#'}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm3.205 13.924c-.167.337-.58.483-.93.332-2.585-1.12-5.46-1.39-7.535-.747-.358.113-.736-.086-.85-.444-.112-.358.087-.736.445-.848 2.378-.737 5.58-.415 8.536.866.35.15.5.568.334.84zm1.186-2.62c-.21.424-.73.593-1.164.398-3.04-1.362-6.853-1.802-9.615-.968-.466.143-.96-.12-1.102-.587-.14-.467.12-.96.586-1.103 3.19-.964 7.42-.486 10.89 1.07.435.195.63.722.405 1.19zm.126-2.736c-3.66-1.688-8.225-2.008-11.23-.974-.564.195-1.17-.11-1.365-.675-.195-.565.11-1.17.675-1.365 3.53-1.216 8.59-.855 12.82 1.096.52.24.747.854.506 1.374-.24.52-.855.748-1.374.506zM15.42 5.56l-3.328 3.326-1.076-1.074c-.39-.39-1.025-.39-1.415 0-.39.39-.39 1.023 0 1.414l1.783 1.78c.195.196.452.294.708.294s.512-.098.707-.293l4.036-4.035c.39-.39.39-1.024 0-1.414-.39-.39-1.024-.39-1.415 0z" /></svg>
                {t('profile.appleCalendar' as any) || 'Apple Calendar'}
              </a>
              <a
                href={feedUrl ? `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}` : '#'}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-medium hover:bg-slate-50 transition-colors shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                {t('profile.googleCalendar' as any) || 'Google Calendar'}
              </a>
              <a
                href={feedUrl ? `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=PassBar+Study+Plan` : '#'}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0078D4] text-white font-medium hover:bg-[#006cbd] transition-colors shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12.924 3.754l8.328-1.52A1.25 1.25 0 0122.5 3.46v17.078a1.25 1.25 0 01-1.026 1.228l-8.55 1.56a1.25 1.25 0 01-1.424-1.228V4.982a1.25 1.25 0 011.424-1.228zm-1.424.31v15.872a.25.25 0 01-.25.25H2.75a1.25 1.25 0 01-1.25-1.25V5.064a1.25 1.25 0 011.25-1.25h8.5a.25.25 0 01.25.25zm5.75 6.436h-2.5v2.5h2.5v-2.5zm0-4.5h-2.5v2.5h2.5v-2.5zm0 9h-2.5v2.5h2.5v-2.5z"/></svg>
                {t('profile.outlookCalendar' as any) || 'Outlook'}
              </a>
              <button
                onClick={handleCopy}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-lg border font-medium transition-colors shadow-sm",
                  copied ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                )}
              >
                {copied ? <Check className="w-5 h-5" /> : <LinkIcon className="w-5 h-5" />}
                {copied ? (t('profile.linkCopied' as any) || 'Copied!') : (t('profile.copyLink' as any) || 'Copy Link')}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Badges Section */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Medal className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold tracking-tight">{t('profile.achievementBadges')}</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {badges.map(({ badge, unlocked, progress }, index) => {
            const Icon = IconMap[badge.iconName] || Star;
            return (
              <Card
                key={badge.id}
                className={cn(
                  "group overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards",
                  unlocked
                    ? "border-primary/50 shadow-md hover:shadow-lg hover:-translate-y-1 bg-gradient-to-br from-white to-primary/5"
                    : "border-muted bg-muted/30 opacity-80 hover:opacity-100 hover:-translate-y-0.5"
                )}
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      "p-3 rounded-2xl shadow-sm transition-transform duration-300 group-hover:scale-110",
                      unlocked ? "bg-primary/10 text-primary group-hover:rotate-6" : "bg-slate-200 text-slate-400 grayscale"
                    )}>
                      <Icon className="w-8 h-8" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h3 className={cn(
                        "font-bold leading-none",
                        unlocked ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {t(badge.titleKey as any) || badge.titleKey}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t(badge.descriptionKey as any) || badge.descriptionKey}
                      </p>
                    </div>
                  </div>

                  {!unlocked && (
                    <div className="mt-6 space-y-2">
                      {progress ? (
                        <>
                          <div className="flex justify-between text-xs font-medium text-muted-foreground">
                            <span>{t('profile.progress')}</span>
                            <span>{progress.current} / {progress.total}</span>
                          </div>
                          <Progress value={(progress.current / progress.total) * 100} className="h-1.5 transition-all duration-500" />
                        </>
                      ) : (
                        <p className="text-xs font-medium text-slate-500 bg-slate-100 p-2 rounded-md flex items-center gap-1.5">
                          <Lock className="h-3 w-3 shrink-0" /> {t(badge.unlockHintKey as any) || badge.unlockHintKey}
                        </p>
                      )}
                    </div>
                  )}

                  {unlocked && (
                    <div className="mt-4 pt-4 border-t border-primary/10">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                        <Zap className="w-3 h-3 animate-pulse" /> {t('profile.unlocked')}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
