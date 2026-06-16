import { supabase } from './supabase';
import { normalizeStudySettings, type StudySettings } from './study-settings';

export async function loadUserStudySettings(userId: string): Promise<StudySettings | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('study_settings')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[PassBar] Failed to load study settings:', error.message);
    return null;
  }

  return normalizeStudySettings((data?.study_settings ?? null) as Partial<StudySettings> | null);
}

export async function saveUserStudySettings(userId: string, settings: StudySettings) {
  if (!supabase) return false;

  const payload = {
    study_settings: normalizeStudySettings(settings),
    updated_at: new Date().toISOString(),
  };

  console.log('[PassBar] Saving study settings:', JSON.stringify(payload.study_settings?.studyPlan?.studyDaysPerWeek));

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[PassBar] Failed to save study settings:', error.message, error.code);
    return false;
  }

  console.log('[PassBar] Save result data:', data);

  if (!data) {
    console.warn('[PassBar] Update returned no rows, trying upsert...');
    const { error: upsertError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        ...payload,
      }, {
        onConflict: 'id',
      });

    if (upsertError) {
      console.warn('[PassBar] Failed to create profile for study settings:', upsertError.message);
      return false;
    }
  }

  return true;
}

export async function updateUserExamDate(userId: string, examDate: string | null) {
  if (!supabase) return false;

  const { error } = await supabase
    .from('profiles')
    .update({ exam_date: examDate, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    console.warn('[PassBar] Failed to update exam date:', error.message);
    return false;
  }

  return true;
}
