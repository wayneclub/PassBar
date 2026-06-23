import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { questionAiExplanations } from '../db/schema';

export const QUESTION_AI_PROMPT_VERSION = 'question-analysis-v4';

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

type AnalysisInput = {
  questionId: string;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  interfaceLanguage: string;
};

@Injectable()
export class QuestionAiAnalysisService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getCached(input: AnalysisInput): Promise<string | null> {
    const selectedChoice = normalizeChoice(input.selectedChoice);
    const correctChoice = normalizeChoice(input.correctChoice);

    const row = await this.db.query.questionAiExplanations.findFirst({
      where: and(
        eq(questionAiExplanations.questionId, input.questionId),
        eq(questionAiExplanations.interfaceLanguage, input.interfaceLanguage),
        eq(questionAiExplanations.promptVersion, QUESTION_AI_PROMPT_VERSION),
        selectedChoice
          ? eq(questionAiExplanations.selectedChoice, selectedChoice)
          : isNull(questionAiExplanations.selectedChoice),
        correctChoice
          ? eq(questionAiExplanations.correctChoice, correctChoice)
          : isNull(questionAiExplanations.correctChoice),
      ),
    });

    if (!row?.analysisMarkdown) return null;
    if (looksLikeSessionFeedback(row.analysisMarkdown)) return null;
    return row.analysisMarkdown;
  }

  async save(
    input: AnalysisInput & {
      isCorrect?: boolean;
      analysisMarkdown: string;
      model?: string | null;
    },
  ) {
    await this.db
      .insert(questionAiExplanations)
      .values({
        questionId: input.questionId,
        selectedChoice: normalizeChoice(input.selectedChoice),
        correctChoice: normalizeChoice(input.correctChoice),
        isCorrect: Boolean(input.isCorrect),
        interfaceLanguage: input.interfaceLanguage,
        promptVersion: QUESTION_AI_PROMPT_VERSION,
        analysisMarkdown: input.analysisMarkdown,
        model: input.model ?? null,
        source: 'gemini',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          questionAiExplanations.questionId,
          questionAiExplanations.selectedChoice,
          questionAiExplanations.correctChoice,
          questionAiExplanations.interfaceLanguage,
          questionAiExplanations.promptVersion,
        ],
        set: {
          analysisMarkdown: input.analysisMarkdown,
          model: input.model ?? null,
          isCorrect: Boolean(input.isCorrect),
          updatedAt: new Date(),
        },
      });
  }
}
