import { api, ApiError } from './api';
import { withBasePath } from './site';

// ... (other types kept as they are)

async function invokeNextApi(body: Record<string, unknown>, retried = false): Promise<GeminiResponse> {
  try {
    return await api.post<GeminiResponse>('/gemini-feedback', body);
  } catch (err) {
    // 網路層中斷（ERR_NETWORK_CHANGED、斷線、休眠喚醒）fetch 丟的是 TypeError 而非
    // ApiError；Gemini 請求耗時較長、撞上瞬斷的機率高，這類錯誤自動重試一次。
    if (!(err instanceof ApiError) && !retried) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return invokeNextApi(body, true);
    }
    const message = err instanceof Error && err.message ? err.message : '';
    throw new Error(message || 'Gemini backend could not be reached.');
  }
}

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
  action?: 'status' | 'feedback' | 'question-analysis';
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


async function invokeGemini(body: Record<string, unknown>) {
  return invokeNextApi(body);
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

export type PerformanceDiagnosisRequest = {
  interfaceLanguage?: string;
  performanceStats: {
    totalAttempts: number;
    correctAttempts: number;
    avgTimeSeconds: number;
    weakConcepts: Array<{
      concept: string;
      subject: string;
      topic: string;
      attempts: number;
      correct: number;
      avgTime: number;
    }>;
    errorTypeBreakdown: Record<string, number>;
    recentTrend: number[];
    streakDays: number;
  };
};

export async function requestPerformanceDiagnosis(input: PerformanceDiagnosisRequest): Promise<string> {
  const data = await invokeGemini({ action: 'performance-diagnosis', ...input });
  if (!data.feedback) throw new Error(data.details || data.error || 'Unable to generate diagnosis.');
  return data.feedback;
}

export async function requestGeminiQuestionAnalysis(input: GeminiQuestionAnalysisRequest) {
  const data = await invokeGemini({ action: 'question-analysis', ...input });
  if (!data.feedback) throw new Error(data.details || data.error || 'Unable to generate Gemini question analysis.');
  if (data.action !== 'question-analysis') {
    throw new Error('Gemini question analysis backend is stale. Check /api/gemini-feedback handles question-analysis as single-question feedback.');
  }
  return data.feedback;
}
