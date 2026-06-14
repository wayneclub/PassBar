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
  LogOut
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
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

  useEffect(() => {
    const saved = profile?.study_settings?.selectedTitle;
    setSelectedTitle(saved || t('profile.defaultTitle'));
  }, [profile, t]);

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
      if (!supabase) throw new Error("Supabase not initialized");

      // 1. Fetch user data to build AchievementData
      const [progressRes, sessionsRes, chapterCountsRes] = await Promise.all([
        supabase.from('user_question_progress').select('is_correct, last_answered_at, question_items(chapters(subject))').eq('user_id', user!.id).in('status', ['correct', 'incorrect']),
        supabase.from('practice_sessions').select('started_at, total_time_seconds').eq('user_id', user!.id),
        supabase.from('question_chapter_counts').select('subject, count')
      ]);

      const progressRows = progressRes.data || [];
      const totalSolved = progressRows.length;
      
      // Calculate streak
      const answeredDates = progressRows.map(r => r.last_answered_at).filter(Boolean) as string[];
      const answeredDayKeys = new Set(
        answeredDates.map(value => {
          const d = new Date(value);
          return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
        })
      );
      let streak = 0;
      const cursor = new Date();
      cursor.setHours(0,0,0,0);
      while (answeredDayKeys.has(cursor.toISOString().slice(0, 10))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }

      // Longest single-day cumulative study time
      const dailyStudySeconds = new Map<string, number>();
      (sessionsRes.data || []).forEach(session => {
        const d = new Date(session.started_at);
        const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
        const existing = dailyStudySeconds.get(dayKey) || 0;
        dailyStudySeconds.set(dayKey, existing + (session.total_time_seconds || 0));
      });
      const maxDailyStudySeconds = Math.max(0, ...dailyStudySeconds.values());

      // Subject performance
      const subjectStats = new Map<string, { correct: number; total: number }>();
      progressRows.forEach(row => {
        // @ts-ignore
        const subj = row.question_items?.chapters?.subject;
        if (subj) {
          const existing = subjectStats.get(subj) || { correct: 0, total: 0 };
          existing.total++;
          if (row.is_correct) existing.correct++;
          subjectStats.set(subj, existing);
        }
      });
      
      const subjectPerformance = Array.from(subjectStats.entries()).map(([name, s]) => ({
        name,
        score: s.total > 0 ? (s.correct / s.total) * 100 : 0,
        correct: s.correct,
        total: s.total
      }));

      // Chapter stats (simplified mock for now since we don't fetch practice_answers for R30/R7 details in this profile load)
      // To keep it fast, we will pass empty chapter stats, which means some spaced repetition badges might not evaluate live accurately here unless we fetch practice_answers.
      // For a real production app, we'd fetch the same as dashboard.
      const chapterStats: any[] = []; 

      const achievementData: AchievementData = {
        streakDays: streak,
        maxDailyStudySeconds,
        chapterStats,
        subjectPerformance
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
        totalSolved,
        streakDays: streak,
        joinDate: user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Recently'
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
