"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { getMbeChineseLabel } from '@/lib/mbe-labels';
import { getQuestionsByChapterIds, getSubjects } from '@/lib/question-bank';
import { getBrowseProgressByUser, BrowseProgressRow, deleteBrowseProgressForUser } from '@/lib/topic-study-progress';
import { getBrowseChapterStateCounts, deleteBrowseQuestionStatesForChapter } from '@/lib/topic-study-question-states';
import { saveTestQuestionSnapshot } from '@/lib/offline-cache';
import { Subject, TestSession } from '@/lib/types';
import { BookOpen, Footprints, ArrowRight, RotateCcw, BookOpenCheck, Bookmark } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type ChapterSession = {
  chapterId: string;
  chapterName: string;
  chapterLabel: string;
  subjectName: string;
  subjectLabel: string;
  totalCount: number;
  viewedCount: number;
  pct: number;
  lastQuestionIndex: number;
  lastRead: string;
  isCompleted: boolean;
  learnedCount: number;
  markedCount: number;
};

export default function FootprintPage() {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const router = useRouter();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [browseProgress, setBrowseProgress] = useState<BrowseProgressRow[]>([]);
  const [chapterStateCounts, setChapterStateCounts] = useState<Map<string, { learnedCount: number; markedCount: number }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [startingChapter, setStartingChapter] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getSubjects(),
      user?.id ? getBrowseProgressByUser(user.id) : Promise.resolve([]),
      user?.id ? getBrowseChapterStateCounts(user.id) : Promise.resolve(new Map()),
    ]).then(([subs, progress, stateCounts]) => {
      setSubjects(subs);
      setBrowseProgress(progress);
      setChapterStateCounts(stateCounts);
      setIsLoading(false);
    });
  }, [user?.id]);

  const progressByChapter = useMemo(() => {
    const map = new Map<string, BrowseProgressRow>();
    browseProgress.forEach((p) => map.set(p.chapter_id, p));
    return map;
  }, [browseProgress]);

  // Build a flat list of chapters that have progress, sorted by most recently read
  const chapterSessions = useMemo((): ChapterSession[] => {
    const result: ChapterSession[] = [];
    subjects.forEach((subject) => {
      subject.chapters.forEach((chapter) => {
        const progress = progressByChapter.get(chapter.id);
        if (!progress) return;
        const pct = chapter.count > 0
          ? Math.round((progress.viewed_count / chapter.count) * 100)
          : 0;
        const { learnedCount, markedCount } = chapterStateCounts.get(chapter.id) ?? { learnedCount: 0, markedCount: 0 };
        result.push({
          chapterId: chapter.id,
          chapterName: chapter.name,
          chapterLabel: getMbeChineseLabel(chapter.name, language) ?? '',
          subjectName: subject.name,
          subjectLabel: getMbeChineseLabel(subject.name, language) ?? '',
          totalCount: chapter.count,
          viewedCount: progress.viewed_count,
          pct,
          lastQuestionIndex: progress.last_question_index,
          lastRead: new Date(progress.updated_at).toLocaleDateString(
            language === 'en' ? 'en-US' : language,
            { year: 'numeric', month: 'numeric', day: 'numeric' },
          ),
          isCompleted: progress.viewed_count >= chapter.count,
          learnedCount,
          markedCount,
        });
      });
    });
    // Sort by most recently read
    return result.sort((a, b) => {
      const pa = progressByChapter.get(a.chapterId)!;
      const pb = progressByChapter.get(b.chapterId)!;
      return new Date(pb.updated_at).getTime() - new Date(pa.updated_at).getTime();
    });
  }, [subjects, progressByChapter, chapterStateCounts, language]);

  const totalViewed = useMemo(
    () => browseProgress.reduce((s, p) => s + p.viewed_count, 0),
    [browseProgress],
  );
  const totalQuestions = useMemo(
    () => subjects.reduce((s, sub) => s + sub.count, 0),
    [subjects],
  );
  const overallPct = totalQuestions > 0 ? Math.round((totalViewed / totalQuestions) * 100) : 0;

  const handleContinue = async (chapterId: string, startIndex: number, restart = false) => {
    setStartingChapter(chapterId);
    if (restart && user) {
      await Promise.all([
        deleteBrowseProgressForUser(user.id, [chapterId]),
        deleteBrowseQuestionStatesForChapter(user.id, chapterId),
      ]);
    }
    const questions = await getQuestionsByChapterIds([chapterId], 99999);
    const sessionId = crypto.randomUUID();
    const session: TestSession = {
      id: sessionId,
      createdAt: Date.now(),
      mode: 'TopicStudy',
      subjects: Array.from(new Set(questions.map((q) => q.subject))),
      chapters: [chapterId],
      questionCount: questions.length,
      questionIds: questions.map((q) => q.id),
      userAnswers: {},
      status: 'In-Progress',
      timeSpent: 0,
    };
    const stored = JSON.parse(localStorage.getItem('passbar_sessions') || '[]');
    stored.push(session);
    localStorage.setItem('passbar_sessions', JSON.stringify(stored));
    await saveTestQuestionSnapshot(sessionId, questions);
    setStartingChapter(null);
    router.push(`/test?id=${encodeURIComponent(sessionId)}&startIndex=${startIndex}`);
  };

  if (isLoading) {
    return <div className="animate-pulse rounded-md bg-muted/30 h-32" />;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-primary">{t('footprint.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('footprint.description')}</p>
        </div>
        <Link href="/topic-study">
          <Button className="gap-2 h-11 px-5 font-semibold">
            <BookOpen className="h-4 w-4" />
            {t('nav.browse')}
          </Button>
        </Link>
      </header>

      {chapterSessions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-16 gap-4 text-center">
            <Footprints className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('footprint.noProgress')}</p>
            <p className="text-xs text-muted-foreground max-w-xs">{t('footprint.noProgressDescription')}</p>
            <Link href="/topic-study">
              <Button size="sm">{t('footprint.startBrowsing')}</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Overall progress banner */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-end justify-between mb-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {t('footprint.overallProgress')}
                  </div>
                  <div className="text-3xl font-bold text-primary mt-0.5">{overallPct}%</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-slate-800">{totalViewed.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">/ {totalQuestions.toLocaleString()} {t('browse.totalQuestions')}</div>
                </div>
              </div>
              <Progress value={overallPct} className="h-2" />
            </CardContent>
          </Card>

          {/* Chapter session list */}
          <div className="grid grid-cols-1 gap-4">
            {chapterSessions.map((cs) => {
              const resumeIndex = cs.isCompleted ? 0 : cs.lastQuestionIndex + 1;
              const isStarting = startingChapter === cs.chapterId;

              return (
                <Card
                  key={cs.chapterId}
                  className="overflow-hidden hover:shadow-md transition-shadow group border-l-4 border-l-primary"
                >
                  <CardContent className="p-0">
                    <div className="flex flex-col md:flex-row items-stretch">
                      {/* Progress circle / stat */}
                      <div className="p-5 md:w-36 border-b md:border-b-0 md:border-r flex flex-col items-center justify-center bg-primary/5 shrink-0 gap-1">
                        <div className={cn(
                          'text-3xl font-black',
                          cs.isCompleted ? 'text-green-600' : 'text-primary',
                        )}>
                          {cs.pct}%
                        </div>
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {cs.isCompleted
                            ? t('footprint.completed')
                            : `${cs.viewedCount}/${cs.totalCount}`}
                        </div>
                      </div>

                      {/* Main content */}
                      <div className="px-5 py-4 flex-1 flex flex-col gap-2.5">
                        {/* Chapter + subject tags */}
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">
                              {cs.subjectName}
                            </span>
                            {cs.subjectLabel && (
                              <span className="text-xs text-slate-400">{cs.subjectLabel}</span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-sm font-semibold text-slate-800">{cs.chapterName}</span>
                            {cs.chapterLabel && (
                              <span className="text-xs text-slate-400">{cs.chapterLabel}</span>
                            )}
                          </div>
                        </div>

                        {/* Progress bar */}
                        <Progress
                          value={cs.pct}
                          className={cn('h-1.5', cs.isCompleted && '[&>div]:bg-green-500')}
                        />

                        {/* Meta + actions */}
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{t('footprint.lastRead')}: {cs.lastRead}</span>
                            {cs.isCompleted && (
                              <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5">
                                {t('footprint.completed')}
                              </Badge>
                            )}
                            {cs.learnedCount > 0 && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <BookOpenCheck className="h-3 w-3" /> {cs.learnedCount} 已學習
                              </span>
                            )}
                            {cs.markedCount > 0 && (
                              <span className="flex items-center gap-1 text-xs text-amber-600">
                                <Bookmark className="h-3 w-3" /> {cs.markedCount} 已標記
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {!cs.isCompleted && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5 text-xs text-slate-400 hover:text-slate-600"
                                disabled={isStarting}
                                onClick={() => handleContinue(cs.chapterId, 0, true)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                {t('footprint.startOver')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 text-sm group-hover:text-primary"
                              disabled={isStarting}
                              onClick={() => handleContinue(cs.chapterId, cs.isCompleted ? 0 : resumeIndex, cs.isCompleted)}
                            >
                              {isStarting ? (
                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                              ) : cs.isCompleted ? (
                                <>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  {t('footprint.startOver')}
                                </>
                              ) : (
                                <>
                                  {t('footprint.resumeAt', { index: resumeIndex + 1 })}
                                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
