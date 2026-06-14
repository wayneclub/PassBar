"use client";

/** Legacy top-level mode kept for backward compat */
export type ContentMode = 'english' | 'bilingual';
export type TextSize = 'medium' | 'large';
export type InterfaceLanguage = 'en' | 'zh-Hans' | 'zh-Hant';

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
  studyDaysPerWeek: number[];
  triageWeeks: number;
  /** Per-subject confidence level (0-100). Lower confidence → more questions allocated. */
  subjectConfidence?: Record<string, number>;
  /** Hours available for study on a study day. Used to cap the daily quota. */
  dailyStudyHours?: number;
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

export type StudySettings = {
  contentMode: ContentMode;
  textSize: TextSize;
  interfaceLanguage: InterfaceLanguage;
  display: DisplayOptions;
  showNotes: boolean;
  studyPlan?: StudyPlanSettings;
  dashboardWidgets: DashboardWidgetVisibility;
};

export const defaultDisplayOptions: DisplayOptions = {
  enQA: true,
  zhQA: false,
  enExplanation: true,
  zhExplanation: false,
};

export const defaultStudySettings: StudySettings = {
  contentMode: 'english',
  textSize: 'medium',
  interfaceLanguage: 'en',
  display: defaultDisplayOptions,
  showNotes: true,
  studyPlan: {
    studyDaysPerWeek: [1, 2, 3, 4, 5],
    triageWeeks: 2,
    dailyStudyHours: 3,
  },
  dashboardWidgets: defaultDashboardWidgets,
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
  const studyPlan = settings?.studyPlan ? {
    studyDaysPerWeek: Array.isArray(settings.studyPlan.studyDaysPerWeek)
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
  } : undefined;

  const dashboardWidgets: DashboardWidgetVisibility = {
    ...defaultDashboardWidgets,
    ...(settings?.dashboardWidgets ?? {}),
  };

  return {
    contentMode,
    textSize: settings?.textSize === 'large' ? 'large' : 'medium',
    interfaceLanguage: settings?.interfaceLanguage === 'zh-Hans' || settings?.interfaceLanguage === 'zh-Hant'
      ? settings.interfaceLanguage
      : 'en',
    display,
    showNotes: settings?.showNotes ?? true,
    studyPlan,
    dashboardWidgets,
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
