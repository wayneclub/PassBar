import { supabase } from './supabase';
import { withBasePath } from './site';

export type GeminiAttempt = {
  subject?: string;
  topic?: string;
  questionText?: string;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  isCorrect?: boolean;
  timeSpentSeconds?: number | null;
};

export type GeminiFeedbackRequest = {
  mode?: string;
  totalQuestions?: number;
  attempts?: GeminiAttempt[];
  unansweredCount?: number;
  interfaceLanguage?: string;
};

export type GeminiStatus = 'enabled' | 'disabled' | 'unknown';

type GeminiResponse = {
  enabled?: boolean;
  model?: string | null;
  feedback?: string;
  error?: string;
  details?: string;
};

export type GeminiQuestionAnalysisRequest = {
  questionText?: string;
  options?: Array<{ key: string; text: string }>;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  isCorrect?: boolean;
  explanationText?: string | null;
  topic?: string | null;
  interfaceLanguage?: string;
};

async function invokeSupabaseFunction(body: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke<GeminiResponse>('gemini-feedback', { body });
  if (error) throw error;
  return data ?? {};
}

async function invokeNextApi(body: Record<string, unknown>) {
  const paths = Array.from(new Set([
    withBasePath('/api/gemini-feedback/'),
    '/api/gemini-feedback/',
  ]));

  for (const path of paths) {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) continue;
      return (await response.json()) as GeminiResponse;
    } catch {
      // Try the next path.
    }
  }

  throw new Error('Gemini backend could not be reached.');
}

async function invokeGemini(body: Record<string, unknown>) {
  try {
    return await invokeSupabaseFunction(body);
  } catch {
    return invokeNextApi(body);
  }
}

export async function getGeminiStatus(): Promise<GeminiStatus> {
  try {
    const data = await invokeGemini({ action: 'status' });
    return data.enabled ? 'enabled' : 'disabled';
  } catch {
    return 'unknown';
  }
}

export async function requestGeminiFeedback(input: GeminiFeedbackRequest) {
  const data = await invokeGemini({ action: 'feedback', ...input });
  if (!data.feedback) throw new Error(data.details || data.error || 'Unable to generate Gemini feedback.');
  return data.feedback;
}

export async function requestGeminiQuestionAnalysis(input: GeminiQuestionAnalysisRequest) {
  const data = await invokeGemini({ action: 'question-analysis', ...input });
  if (!data.feedback) throw new Error(data.details || data.error || 'Unable to generate Gemini question analysis.');
  return data.feedback;
}
