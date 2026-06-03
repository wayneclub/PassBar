"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getMbeChineseLabel } from '@/lib/mbe-labels';
import { getSubjects } from '@/lib/question-bank';
import { getBrowseProgressByUser, BrowseProgressRow } from '@/lib/browse-progress';
import { Subject } from '@/lib/types';
import { BookOpen, Footprints } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function FootprintPage() {
  const { user } = useAuth();
  const { t, language } = useI18n();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [browseProgress, setBrowseProgress] = useState<BrowseProgressRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getSubjects(),
      user?.id ? getBrowseProgressByUser(user.id) : Promise.resolve([]),
    ]).then(([subs, progress]) => {
      setSubjects(subs);
      setBrowseProgress(progress);
      setIsLoading(false);
    });
  }, [user?.id]);

  const progressByChapter = useMemo(() => {
    const map = new Map<string, BrowseProgressRow>();
    browseProgress.forEach((p) => map.set(p.chapter_id, p));
    return map;
  }, [browseProgress]);

  const subjectStats = useMemo(() => {
    return subjects.map((subject) => {
      const totalQuestions = subject.count;
      const viewedQuestions = subject.chapters.reduce((sum, ch) => {
        const p = progressByChapter.get(ch.id);
        return sum + (p?.viewed_count ?? 0);
      }, 0);
      const pct = totalQuestions > 0 ? Math.round((viewedQuestions / totalQuestions) * 100) : 0;
      return { subject, totalQuestions, viewedQuestions, pct };
    });
  }, [subjects, progressByChapter]);

  const totalViewed = useMemo(
    () => browseProgress.reduce((s, p) => s + p.viewed_count, 0),
    [browseProgress]
  );
  const totalQuestions = useMemo(
    () => subjects.reduce((s, sub) => s + sub.count, 0),
    [subjects]
  );
  const overallPct = totalQuestions > 0 ? Math.round((totalViewed / totalQuestions) * 100) : 0;

  const hasAnyProgress = browseProgress.length > 0;

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-md bg-muted/30 h-32" />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('footprint.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('footprint.description')}</p>
        </div>
        <Link href="/browse">
          <Button className="gap-2 h-11 px-5 font-semibold">
            <BookOpen className="h-4 w-4" />
            {t('nav.browse')}
          </Button>
        </Link>
      </header>

      {!hasAnyProgress ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-16 gap-4 text-center">
            <Footprints className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('footprint.noProgress')}</p>
            <p className="text-xs text-muted-foreground max-w-xs">{t('footprint.noProgressDescription')}</p>
            <Link href="/browse">
              <Button size="sm">{t('footprint.startBrowsing')}</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Overall progress */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-end justify-between mb-3">
                <div>
                  <div className="text-sm font-medium text-slate-500">Overall Progress</div>
                  <div className="text-3xl font-bold text-primary">{overallPct}%</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-slate-800">{totalViewed.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">/ {totalQuestions.toLocaleString()} {t('browse.totalQuestions')}</div>
                </div>
              </div>
              <Progress value={overallPct} className="h-2" />
            </CardContent>
          </Card>

          {/* Per-subject breakdown */}
          <div className="space-y-4">
            {subjectStats.map(({ subject, totalQuestions: total, viewedQuestions: viewed, pct }) => {
              const subjectLabel = getMbeChineseLabel(subject.name, language);
              const chaptersWithProgress = subject.chapters.filter((ch) => progressByChapter.has(ch.id));

              return (
                <Card key={subject.id} className={cn('hover:shadow-md transition-shadow', pct === 0 && 'opacity-60')}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-base font-semibold">{subject.name}</div>
                        {subjectLabel && <p className="text-sm text-muted-foreground mt-0.5">{subjectLabel}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-bold text-primary">{pct}%</div>
                        <div className="text-xs text-muted-foreground">{t('footprint.viewedOf', { viewed, total })}</div>
                      </div>
                    </div>
                    <Progress value={pct} className="h-1.5 mt-3" />
                  </CardHeader>
                  {chaptersWithProgress.length > 0 && (
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {subject.chapters.map((chapter) => {
                          const progress = progressByChapter.get(chapter.id);
                          if (!progress) return null;
                          const chPct = chapter.count > 0
                            ? Math.round((progress.viewed_count / chapter.count) * 100)
                            : 0;
                          const chapterLabel = getMbeChineseLabel(chapter.name, language);
                          const lastRead = new Date(progress.updated_at).toLocaleDateString();

                          return (
                            <div key={chapter.id} className="flex items-center gap-3 py-1.5 border-t border-slate-100 first:border-0">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-sm font-medium text-slate-700 truncate">{chapter.name}</span>
                                  {chapterLabel && <span className="text-xs text-slate-400 shrink-0">{chapterLabel}</span>}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {t('footprint.lastRead')}: {lastRead}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-bold text-slate-700">{chPct}%</div>
                                <div className="text-xs text-muted-foreground">{progress.viewed_count}/{chapter.count}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
