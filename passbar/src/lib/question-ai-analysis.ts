import { supabase } from './supabase';

export const QUESTION_AI_PROMPT_VERSION = 'question-analysis-v4';

type QuestionAiAnalysisRow = {
  analysis_markdown: string;
  model?: string | null;
  updated_at?: string | null;
};

type QuestionAiAnalysisInput = {
  questionId: string;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  isCorrect?: boolean;
  interfaceLanguage: string;
  analysisMarkdown?: string;
  model?: string | null;
};

function normalizeChoice(choice?: string | null) {
  return choice ? choice.toUpperCase() : null;
}

function looksLikeSessionFeedback(value: string) {
  const normalized = value.toLowerCase();
  return [
    'overall diagnosis',
    'session summary',
    '本次練習尚未開始',
    '本次练习尚未开始',
    '整體診斷',
    '整体诊断',
    '弱點科目',
    '弱点科目',
    '沒有任何作答數據',
    '没有任何作答数据',
    '尚未作答',
  ].some((snippet) => normalized.includes(snippet.toLowerCase()));
}

export async function getCachedQuestionAiAnalysis(input: QuestionAiAnalysisInput) {
  if (!supabase) return null;

  let query = supabase
    .from('question_ai_explanations')
    .select('analysis_markdown, model, updated_at')
    .eq('question_id', input.questionId)
    .eq('interface_language', input.interfaceLanguage)
    .eq('prompt_version', QUESTION_AI_PROMPT_VERSION);

  const selectedChoice = normalizeChoice(input.selectedChoice);
  const correctChoice = normalizeChoice(input.correctChoice);
  query = selectedChoice ? query.eq('selected_choice', selectedChoice) : query.is('selected_choice', null);
  query = correctChoice ? query.eq('correct_choice', correctChoice) : query.is('correct_choice', null);

  const { data, error } = await query.maybeSingle<QuestionAiAnalysisRow>();

  if (error) {
    console.warn('[PassBar] Failed to load cached question AI analysis:', error.message);
    return null;
  }

  if (!data?.analysis_markdown) return null;
  if (looksLikeSessionFeedback(data.analysis_markdown)) return null;
  return data.analysis_markdown;
}

export async function saveQuestionAiAnalysis(input: QuestionAiAnalysisInput) {
  if (!supabase || !input.analysisMarkdown) return;

  const { error } = await supabase
    .from('question_ai_explanations')
    .upsert({
      question_id: input.questionId,
      selected_choice: normalizeChoice(input.selectedChoice),
      correct_choice: normalizeChoice(input.correctChoice),
      is_correct: Boolean(input.isCorrect),
      interface_language: input.interfaceLanguage,
      prompt_version: QUESTION_AI_PROMPT_VERSION,
      analysis_markdown: input.analysisMarkdown,
      model: input.model ?? null,
      source: 'gemini',
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'question_id,selected_choice,correct_choice,interface_language,prompt_version',
    });

  if (error) {
    console.warn('[PassBar] Failed to save question AI analysis:', error.message);
  }
}
