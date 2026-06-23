"use client";

/** Legacy top-level mode kept for backward compat */
export type ContentMode = 'english' | 'bilingual';
export type TextSize = 'small' | 'medium' | 'large';
export type InterfaceLanguage = 'en' | 'zh-Hans' | 'zh-Hant';
export type StudyPaceMode = 'leisure' | 'balanced' | 'intensive';
export type StudySubjectMode = 'singleThenMixed' | 'mixed';

/**
 * Display toggles — grouped by language.
 * enQA:         show English question + choices  (always true by default)
 * zhQA:         show Chinese question + choices  (stacked below EN when both on)
 * enExplanation: show English interactive HTML explanation
 * zhExplanation: show Chinese HTML explanation card
 */
export type DisplayOptions = {
  enQA: boolean;
  zhQA: boolean;
  enExplanation: boolean;
  zhExplanation: boolean;
};

export type StudyPlanSettings = {
  /** Bar exam jurisdiction/type for display and planner defaults (for example: ca, ny, custom). */
  examState?: string | null;
  /** Legacy fallback; canonical exam date lives on profiles.exam_date. */
  examDate?: string | null;
  studyDaysPerWeek: number[];
  triageWeeks: number;
  /** Per-subject confidence level (0-100). Lower confidence → more questions allocated. */
  subjectConfidence?: Record<string, number>;
  /** Hours available for study on a study day. Used to cap the daily quota. */
  dailyStudyHours?: number;
  /** Study/rest rhythm used to convert total study-block hours into effective focus time. */
  paceMode?: StudyPaceMode;
  /** Whether early study days focus on one subject before switching to mixed practice. */
  subjectMode?: StudySubjectMode;
  /** Custom order of subjects for singleThenMixed mode. */
  subjectOrder?: string[];
  /** Target accuracy (%) the user wants to reach before the exam — "safe pass line". */
  passThreshold?: number;
};

/** Dashboard widget visibility toggles — keys correspond to dashboard cards/sections. */
export type DashboardWidgetKey =
  | 'todaysMission'
  | 'spacedReview'
  | 'smartCalendar'
  | 'kpiMastery'
  | 'kpiSolved'
  | 'kpiStreak'
  | 'kpiTime'
  | 'activityHeatmap'
  | 'subjectPerformance'
  | 'recentInsights'
  | 'nextMilestone';

export type DashboardWidgetVisibility = Record<DashboardWidgetKey, boolean>;

export const defaultDashboardWidgets: DashboardWidgetVisibility = {
  todaysMission: true,
  spacedReview: true,
  smartCalendar: true,
  kpiMastery: true,
  kpiSolved: true,
  kpiStreak: true,
  kpiTime: true,
  activityHeatmap: true,
  subjectPerformance: true,
  recentInsights: true,
  nextMilestone: true,
};

/** Push notification preferences — all default to off until the user opts in. */
export type NotificationSettings = {
  /** Master switch — must be on (and permission granted) for any push to be sent. */
  enabled: boolean;
  /** Smart review: notify when chapters become due for spaced review. */
  smartReview: boolean;
  /** Daily study reminder at `dailyReminderTime`. */
  dailyReminder: boolean;
  /** Time of day (HH:mm, 24h, local time) to send the daily reminder. */
  dailyReminderTime: string;
  /** Exam countdown: periodic reminder of days remaining until exam_date. */
  examCountdown: boolean;
};

export type StudySettings = {
  contentMode: ContentMode;
  textSize: TextSize;
  interfaceLanguage: InterfaceLanguage;
  display: DisplayOptions;
  showNotes: boolean;
  autoSaveProgress: boolean;
  studyPlan?: StudyPlanSettings;
  dashboardWidgets: DashboardWidgetVisibility;
  notifications: NotificationSettings;
  /** Whether the user has completed (or dismissed) the dashboard onboarding tour. */
  hasSeenDashboardTour: boolean;
  /** Display title shown on the profile page (e.g. an unlocked achievement title). */
  selectedTitle?: string;
};

export const defaultDisplayOptions: DisplayOptions = {
  enQA: true,
  zhQA: false,
  enExplanation: true,
  zhExplanation: false,
};

export const defaultNotificationSettings: NotificationSettings = {
  enabled: false,
  smartReview: false,
  dailyReminder: false,
  dailyReminderTime: '20:00',
  examCountdown: false,
};

export const defaultStudySettings: StudySettings = {
  contentMode: 'english',
  textSize: 'medium',
  interfaceLanguage: 'en',
  display: defaultDisplayOptions,
  showNotes: true,
  autoSaveProgress: true,
  studyPlan: {
    studyDaysPerWeek: [1, 2, 3, 4, 5],
    triageWeeks: 2,
    dailyStudyHours: 3,
    paceMode: 'balanced',
    subjectMode: 'singleThenMixed',
  },
  dashboardWidgets: defaultDashboardWidgets,
  notifications: defaultNotificationSettings,
  hasSeenDashboardTour: false,
};

const storageKey = 'passbar_study_settings';

export function normalizeStudySettings(settings: Partial<StudySettings> | null | undefined): StudySettings {
  const raw = settings?.display as Partial<DisplayOptions> | undefined;

  // Backward compat: old format had zhQuestion/zhChoices/enExplanation/zhExplanation
  const legacyZh = (raw as Record<string, unknown>)?.zhQuestion === true
    || (raw as Record<string, unknown>)?.zhChoices === true;

  const display: DisplayOptions = {
    enQA:          raw?.enQA          ?? true,
    zhQA:          raw?.zhQA          ?? legacyZh ?? (settings?.contentMode === 'bilingual'),
    enExplanation: raw?.enExplanation ?? (settings?.contentMode !== 'bilingual'),
    zhExplanation: raw?.zhExplanation ?? (settings?.contentMode === 'bilingual'),
  };
  const contentMode: ContentMode = (display.zhQA || display.zhExplanation) ? 'bilingual' : 'english';
  const studyPlan: StudyPlanSettings | undefined = settings?.studyPlan ? {
    examState: typeof settings.studyPlan.examState === 'string'
      ? settings.studyPlan.examState
      : null,
    examDate: typeof settings.studyPlan.examDate === 'string'
      ? settings.studyPlan.examDate
      : null,
    studyDaysPerWeek: Array.isArray(settings.studyPlan.studyDaysPerWeek) && settings.studyPlan.studyDaysPerWeek.length > 0
      ? settings.studyPlan.studyDaysPerWeek
      : [1, 2, 3, 4, 5],
    triageWeeks: typeof settings.studyPlan.triageWeeks === 'number'
      ? settings.studyPlan.triageWeeks
      : 2,
    subjectConfidence: settings.studyPlan.subjectConfidence && typeof settings.studyPlan.subjectConfidence === 'object'
      ? settings.studyPlan.subjectConfidence
      : undefined,
    dailyStudyHours: typeof settings.studyPlan.dailyStudyHours === 'number' && settings.studyPlan.dailyStudyHours > 0
      ? settings.studyPlan.dailyStudyHours
      : 3,
    paceMode: settings.studyPlan.paceMode === 'leisure' || settings.studyPlan.paceMode === 'intensive'
      ? settings.studyPlan.paceMode
      : 'balanced',
    subjectMode: settings.studyPlan.subjectMode === 'mixed'
      ? 'mixed'
      : 'singleThenMixed',
    subjectOrder: Array.isArray(settings.studyPlan.subjectOrder)
      ? settings.studyPlan.subjectOrder
      : undefined,
    passThreshold: typeof settings.studyPlan.passThreshold === 'number'
      && settings.studyPlan.passThreshold > 0
      && settings.studyPlan.passThreshold <= 100
      ? settings.studyPlan.passThreshold
      : 75,
  } : undefined;

  const dashboardWidgets: DashboardWidgetVisibility = {
    ...defaultDashboardWidgets,
    ...(settings?.dashboardWidgets ?? {}),
  };

  const rawNotifications = settings?.notifications as Partial<NotificationSettings> | undefined;
  const notifications: NotificationSettings = {
    enabled: rawNotifications?.enabled ?? defaultNotificationSettings.enabled,
    smartReview: rawNotifications?.smartReview ?? defaultNotificationSettings.smartReview,
    dailyReminder: rawNotifications?.dailyReminder ?? defaultNotificationSettings.dailyReminder,
    dailyReminderTime: typeof rawNotifications?.dailyReminderTime === 'string' && /^\d{2}:\d{2}$/.test(rawNotifications.dailyReminderTime)
      ? rawNotifications.dailyReminderTime
      : defaultNotificationSettings.dailyReminderTime,
    examCountdown: rawNotifications?.examCountdown ?? defaultNotificationSettings.examCountdown,
  };

  return {
    contentMode,
    textSize: settings?.textSize === 'large' || settings?.textSize === 'small' ? settings.textSize : 'medium',
    interfaceLanguage: settings?.interfaceLanguage === 'zh-Hans' || settings?.interfaceLanguage === 'zh-Hant'
      ? settings.interfaceLanguage
      : 'en',
    display,
    showNotes: settings?.showNotes ?? true,
    autoSaveProgress: settings?.autoSaveProgress ?? true,
    studyPlan,
    dashboardWidgets,
    notifications,
    hasSeenDashboardTour: settings?.hasSeenDashboardTour === true,
    selectedTitle: typeof settings?.selectedTitle === 'string' ? settings.selectedTitle : undefined,
  };
}

export function applyStudySettings(settings: StudySettings) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.passbarTextSize = settings.textSize;
  document.documentElement.lang = settings.interfaceLanguage;
}

export function getStudySettings(): StudySettings {
  if (typeof window === 'undefined') return defaultStudySettings;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultStudySettings;
    return normalizeStudySettings(JSON.parse(raw) as Partial<StudySettings>);
  } catch {
    return defaultStudySettings;
  }
}

export function saveStudySettings(settings: StudySettings) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeStudySettings(settings);
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  applyStudySettings(normalized);
  window.dispatchEvent(new CustomEvent('passbar-study-settings-changed', { detail: normalized }));
}
