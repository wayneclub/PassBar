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

export type StudySettings = {
  contentMode: ContentMode;
  textSize: TextSize;
  interfaceLanguage: InterfaceLanguage;
  display: DisplayOptions;
  showNotes: boolean;
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
  return {
    contentMode,
    textSize: settings?.textSize === 'large' ? 'large' : 'medium',
    interfaceLanguage: settings?.interfaceLanguage === 'zh-Hans' || settings?.interfaceLanguage === 'zh-Hant'
      ? settings.interfaceLanguage
      : 'en',
    display,
    showNotes: settings?.showNotes ?? true,
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
