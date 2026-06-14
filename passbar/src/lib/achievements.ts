import { supabase } from '@/lib/supabase';
import { ChapterAttemptStats } from '@/lib/smart-planner';

export type BadgeCategory = 'Consistency' | 'SpacedRepetition' | 'SubjectMastery';

export interface Badge {
  id: string;
  key: string; // Translation key
  category: BadgeCategory;
  titleKey: string;
  descriptionKey: string;
  iconName: string;
  unlockHintKey: string; // Used when the badge is locked
  criteria: (data: AchievementData) => boolean;
  getProgress?: (data: AchievementData) => { current: number; total: number };
}

export interface AchievementData {
  streakDays: number;
  maxDailyStudySeconds: number; // Longest single-day cumulative study time
  chapterStats: ChapterAttemptStats[];
  subjectPerformance: {
    name: string;
    score: number; // percentage (0-100)
    correct: number;
    total: number;
  }[];
}

export const BADGES: Badge[] = [
  {
    id: 'disciplined_master',
    key: 'dashboard.badge.discipline',
    category: 'Consistency',
    titleKey: 'badge.discipline.title',
    descriptionKey: 'badge.discipline.desc',
    iconName: 'Flame',
    unlockHintKey: 'badge.discipline.hint',
    criteria: (data) => data.streakDays >= 7,
    getProgress: (data) => ({ current: Math.min(data.streakDays, 7), total: 7 }),
  },
  {
    id: 'contempt_of_court',
    key: 'dashboard.badge.consistency',
    category: 'Consistency',
    titleKey: 'badge.consistency.title',
    descriptionKey: 'badge.consistency.desc',
    iconName: 'Trophy',
    unlockHintKey: 'badge.consistency.hint',
    criteria: (data) => data.streakDays >= 30,
    getProgress: (data) => ({ current: Math.min(data.streakDays, 30), total: 30 }),
  },
  {
    id: 'midnight_oil',
    key: 'dashboard.badge.midnight_oil',
    category: 'Consistency',
    titleKey: 'badge.midnight_oil.title',
    descriptionKey: 'badge.midnight_oil.desc',
    iconName: 'Coffee',
    unlockHintKey: 'badge.midnight_oil.hint',
    criteria: (data) => data.maxDailyStudySeconds >= 4 * 3600, // 4+ hours of study in a single day
    getProgress: (data) => ({
      current: Math.round(Math.min(data.maxDailyStudySeconds, 4 * 3600) / 360) / 10,
      total: 4,
    }),
  },
  {
    id: 'hearsay_overruled',
    key: 'dashboard.badge.hearsay_overruled',
    category: 'SpacedRepetition',
    titleKey: 'badge.hearsay_overruled.title',
    descriptionKey: 'badge.hearsay_overruled.desc',
    iconName: 'RotateCcw',
    unlockHintKey: 'badge.hearsay_overruled.hint',
    // Mock criteria: any chapter with > 30 days gap and R30 completed
    criteria: (data) => data.chapterStats.some(c => c.totalAttempts >= 3 /* simplified for R30 */),
  },
  {
    id: 'res_judicata',
    key: 'dashboard.badge.res_judicata',
    category: 'SpacedRepetition',
    titleKey: 'badge.res_judicata.title',
    descriptionKey: 'badge.res_judicata.desc',
    iconName: 'CheckCircle2',
    unlockHintKey: 'badge.res_judicata.hint',
    criteria: (data) => data.chapterStats.some(c => c.totalAttempts >= 2 && c.lastAccuracy !== null && c.lastAccuracy >= 85),
  },
  {
    id: 'reasonable_person',
    key: 'dashboard.badge.reasonable_person',
    category: 'SubjectMastery',
    titleKey: 'badge.reasonable_person.title',
    descriptionKey: 'badge.reasonable_person.desc',
    iconName: 'Flag',
    unlockHintKey: 'badge.reasonable_person.hint',
    criteria: (data) => {
      const torts = data.subjectPerformance.find(s => s.name === 'Torts');
      return !!torts && torts.score >= 80 && torts.total >= 10; // At least 10 questions
    },
  },
  {
    id: 'lord_of_consideration',
    key: 'dashboard.badge.lord_of_consideration',
    category: 'SubjectMastery',
    titleKey: 'badge.lord_of_consideration.title',
    descriptionKey: 'badge.lord_of_consideration.desc',
    iconName: 'BookOpen',
    unlockHintKey: 'badge.lord_of_consideration.hint',
    criteria: (data) => {
      const contracts = data.subjectPerformance.find(s => s.name === 'Contracts');
      return !!contracts && contracts.total >= 20; // Simplified "Complete all chapters" -> 20+ questions for now
    },
  },
];

export async function evaluateUserBadges(userId: string, data: AchievementData) {
  if (!supabase) return [];

  // Evaluate unlocked badges based on dynamic data
  const unlockedBadges = BADGES.filter(badge => badge.criteria(data));
  const newBadgeIds = unlockedBadges.map(b => b.id);

  // Sync to user_badges table if there are newly unlocked ones
  if (newBadgeIds.length > 0) {
    const { data: existingBadges, error } = await supabase
      .from('user_badges')
      .select('badge_key')
      .eq('user_id', userId);

    if (!error) {
      const existingKeys = new Set((existingBadges || []).map(b => b.badge_key));
      const toInsert = unlockedBadges
        .filter(b => !existingKeys.has(b.id))
        .map(b => ({ user_id: userId, badge_key: b.id }));

      if (toInsert.length > 0) {
        await supabase.from('user_badges').insert(toInsert);
      }
    }
  }

  return unlockedBadges;
}

export async function fetchUserBadges(userId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('user_badges')
    .select('badge_key, unlocked_at')
    .eq('user_id', userId);
    
  if (error) {
    console.error('Error fetching user badges:', error);
    return [];
  }
  
  return data || [];
}
