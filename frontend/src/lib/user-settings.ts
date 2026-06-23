import { api, ApiError } from './api';
import { normalizeStudySettings, type StudySettings } from './study-settings';

export async function loadUserStudySettings(_userId: string): Promise<StudySettings | null> {
  try {
    const data = await api.get<{ studySettings: Partial<StudySettings> | null }>('/users/me');
    return normalizeStudySettings(data.studySettings ?? null);
  } catch (err) {
    console.warn('[PassBar] Failed to load study settings:', err);
    return null;
  }
}

export async function saveUserStudySettings(_userId: string, settings: StudySettings): Promise<boolean> {
  try {
    await api.patch('/users/me/study-settings', { studySettings: normalizeStudySettings(settings) });
    return true;
  } catch (err) {
    console.warn('[PassBar] Failed to save study settings:', err instanceof ApiError ? err.message : err);
    return false;
  }
}

export async function updateUserExamDate(_userId: string, examDate: string | null): Promise<boolean> {
  try {
    await api.patch('/users/me/exam-date', { examDate });
    return true;
  } catch (err) {
    console.warn('[PassBar] Failed to update exam date:', err instanceof ApiError ? err.message : err);
    return false;
  }
}
