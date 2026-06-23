import { api } from './api';

export const QUESTION_AI_PROMPT_VERSION = 'question-analysis-v4';

type QuestionAiAnalysisInput = {
  questionId: string;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  isCorrect?: boolean;
  interfaceLanguage: string;
  analysisMarkdown?: string;
  model?: string | null;
};

export async function getCachedQuestionAiAnalysis(input: QuestionAiAnalysisInput) {
  try {
    const { analysisMarkdown } = await api.post<{ analysisMarkdown: string | null }>('/question-ai-analysis/cached', {
      questionId: input.questionId,
      selectedChoice: input.selectedChoice ?? undefined,
      correctChoice: input.correctChoice ?? undefined,
      interfaceLanguage: input.interfaceLanguage,
    });
    return analysisMarkdown;
  } catch (err) {
    console.warn('[PassBar] Failed to load cached question AI analysis:', err);
    return null;
  }
}

export async function saveQuestionAiAnalysis(input: QuestionAiAnalysisInput) {
  if (!input.analysisMarkdown) return;
  try {
    await api.post('/question-ai-analysis', {
      questionId: input.questionId,
      selectedChoice: input.selectedChoice ?? undefined,
      correctChoice: input.correctChoice ?? undefined,
      isCorrect: Boolean(input.isCorrect),
      interfaceLanguage: input.interfaceLanguage,
      analysisMarkdown: input.analysisMarkdown,
      model: input.model ?? undefined,
    });
  } catch (err) {
    console.warn('[PassBar] Failed to save question AI analysis:', err);
  }
}
