"use client";

export type ContentMode = 'english' | 'bilingual';
export type TextSize = 'medium' | 'large';
export type InterfaceLanguage = 'en' | 'zh-Hans' | 'zh-Hant';

export type StudySettings = {
  contentMode: ContentMode;
  textSize: TextSize;
  interfaceLanguage: InterfaceLanguage;
};

export const defaultStudySettings: StudySettings = {
  contentMode: 'english',
  textSize: 'medium',
  interfaceLanguage: 'en',
};

const storageKey = 'passbar_study_settings';

export function normalizeStudySettings(settings: Partial<StudySettings> | null | undefined): StudySettings {
  return {
    contentMode: settings?.contentMode === 'bilingual' ? 'bilingual' : 'english',
    textSize: settings?.textSize === 'large' ? 'large' : 'medium',
    interfaceLanguage: settings?.interfaceLanguage === 'zh-Hans' || settings?.interfaceLanguage === 'zh-Hant'
      ? settings.interfaceLanguage
      : 'en',
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
