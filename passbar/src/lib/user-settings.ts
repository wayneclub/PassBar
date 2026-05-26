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

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[PassBar] Failed to save study settings:', error.message);
    return false;
  }

  if (!data) {
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
