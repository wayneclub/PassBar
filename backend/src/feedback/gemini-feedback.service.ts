import { Injectable, InternalServerErrorException, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type FeedbackAttempt = {
  subject?: string;
  topic?: string;
  questionText?: string;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  isCorrect?: boolean;
  timeSpentSeconds?: number | null;
};

export type PerformanceStats = {
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

export class GeminiFeedbackRequestDto {
  action?: 'status' | 'feedback' | 'question-analysis' | 'performance-diagnosis';
  mode?: string;
  totalQuestions?: number;
  attempts?: FeedbackAttempt[];
  unansweredCount?: number;
  interfaceLanguage?: string;
  questionText?: string;
  options?: Array<{ key: string; text: string }>;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  isCorrect?: boolean;
  explanationText?: string | null;
  topic?: string | null;
  performanceStats?: PerformanceStats;
}

// gemini-3.5-flash 對部分 API key 會回 404/503（見 CLAUDE.md「Gemini API 模型名稱」），
// 失敗時依序退到已確認穩定的模型，避免整個 endpoint 直接 502。
const fallbackModels = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];

// gemini-3.5-flash 過載時可能掛住不回應（而非快速回 503）。反向代理 60 秒就會斷線回 504，
// 所以單一模型最多等 25 秒、整體 50 秒內要試完，確保 fallback 有機會執行並趕在代理逾時前回應。
const PER_MODEL_TIMEOUT_MS = 25_000;
const OVERALL_DEADLINE_MS = 50_000;

@Injectable()
export class GeminiFeedbackService {
  constructor(private readonly configService: ConfigService) {}

  private getApiKey(): string {
    return (
      this.configService.get<string>('GEMINI_API_KEY') ||
      this.configService.get<string>('GOOGLE_GENAI_API_KEY') ||
      ''
    );
  }

  private getModelsToTry(): string[] {
    const preferred = this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.5-flash';
    return Array.from(new Set([preferred, ...fallbackModels]));
  }

  private trimText(value: string | undefined, maxLength = 900): string {
    if (!value) return '';
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  private buildPrompt(input: GeminiFeedbackRequestDto): string {
    const attempts = (input.attempts ?? []).slice(0, 80);
    const correct = attempts.filter((attempt) => attempt.isCorrect).length;
    const incorrect = attempts.filter((attempt) => attempt.isCorrect === false).length;
    const languageInstruction =
      input.interfaceLanguage === 'zh-Hant'
        ? 'Respond in Traditional Chinese.'
        : input.interfaceLanguage === 'zh-Hans'
          ? 'Respond in Simplified Chinese.'
          : 'Respond in English.';

    return `You are PassBar's MBE study coach. Analyze the user's current practice session and give concise, actionable feedback.

${languageInstruction}

Session summary:
- Mode: ${input.mode ?? 'Practice'}
- Total questions in session: ${input.totalQuestions ?? attempts.length}
- Answered: ${attempts.length}
- Correct: ${correct}
- Incorrect: ${incorrect}
- Unanswered: ${input.unansweredCount ?? 0}

Answered question data:
${attempts
  .map(
    (attempt, index) => `Question ${index + 1}
Subject: ${attempt.subject ?? 'Unknown'}
Chapter: ${attempt.topic ?? 'Unknown'}
Selected: ${attempt.selectedChoice ?? 'N/A'}
Correct: ${attempt.correctChoice ?? 'N/A'}
Result: ${attempt.isCorrect ? 'Correct' : 'Incorrect'}
Time spent: ${attempt.timeSpentSeconds ?? 'unknown'} seconds
Question excerpt: ${this.trimText(attempt.questionText)}
`,
  )
  .join('\n')}

Return the feedback in this structure:
1. Overall diagnosis in 2-3 sentences.
2. Strengths.
3. Weak areas by subject/chapter.
4. Concrete next study plan for the next practice session.
5. Timing advice if time data is available.

Do not mention that you are an AI model. Keep it practical and study-focused.`;
  }

  private buildPerformanceDiagnosisPrompt(input: GeminiFeedbackRequestDto): string {
    const languageInstruction =
      input.interfaceLanguage === 'zh-Hant'
        ? 'Respond in Traditional Chinese.'
        : input.interfaceLanguage === 'zh-Hans'
          ? 'Respond in Simplified Chinese.'
          : 'Respond in English.';

    const stats = input.performanceStats ?? {
      totalAttempts: 0,
      correctAttempts: 0,
      avgTimeSeconds: 0,
      weakConcepts: [],
      errorTypeBreakdown: {},
      recentTrend: [],
      streakDays: 0,
    };
    const accuracy = stats.totalAttempts > 0 ? Math.round((stats.correctAttempts / stats.totalAttempts) * 100) : 0;

    return `You are PassBar's MBE study coach. Analyze the user's overall practice performance and produce a structured diagnosis.

${languageInstruction}

Performance summary:
- Total questions answered: ${stats.totalAttempts}
- Correct: ${stats.correctAttempts} (${accuracy}% overall accuracy)
- Average time per question: ${stats.avgTimeSeconds} seconds
- Current study streak: ${stats.streakDays} days
- Recent accuracy trend (oldest to newest, in %): ${stats.recentTrend.join(', ') || 'not enough data'}
- Error type breakdown: ${Object.entries(stats.errorTypeBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}

Weakest concepts (lowest accuracy first):
${stats.weakConcepts
  .map(
    (c) =>
      `- ${c.subject} / ${c.topic} / ${c.concept}: ${c.correct}/${c.attempts} correct, avg ${c.avgTime}s`,
  )
  .join('\n') || 'none identified yet'}

Respond with ONLY a single JSON object (no markdown fences, no extra text) matching exactly this shape:
{
  "diagnosis": string,            // 2-3 sentence overall diagnosis of the user's current performance
  "topPriorities": [              // up to 3 concepts the user should focus on next, ordered by priority
    { "concept": string, "subject": string, "reason": string, "suggestedMinutes": number }
  ],
  "studyPlan": [                  // 3-5 concrete steps for the next study session
    { "step": number, "action": string, "duration": string }
  ],
  "encouragement": string,        // a short, specific encouraging remark
  "readinessScore": number        // 0-100 estimate of exam readiness based on the data above
}`;
  }

  private buildQuestionAnalysisPrompt(input: GeminiFeedbackRequestDto): string {
    const languageInstruction =
      input.interfaceLanguage === 'zh-Hant'
        ? 'Respond in Traditional Chinese.'
        : input.interfaceLanguage === 'zh-Hans'
          ? 'Respond in Simplified Chinese.'
          : 'Respond in English.';

    const options = (input.options ?? [])
      .map((option) => `${option.key}. ${this.trimText(option.text, 700)}`)
      .join('\n');

    const selectedChoice = input.selectedChoice ?? 'N/A';
    const correctChoice = input.correctChoice ?? 'N/A';
    const isCorrect =
      typeof input.isCorrect === 'boolean'
        ? input.isCorrect
        : Boolean(
            input.selectedChoice &&
              input.correctChoice &&
              input.selectedChoice === input.correctChoice,
          );

    // 段落標題跟隨使用者介面語言，不能固定繁中
    const h =
      input.interfaceLanguage === 'zh-Hant'
        ? {
            keywords: '關鍵字', whyCorrect: `為什麼選 ${correctChoice}`, trap: '陷阱檢查',
            related: '延伸考點', tip: '考試提醒', whyWrong: '錯誤原因',
            correctAnswer: '正確答案', choiceAnalysis: '選項分析',
          }
        : input.interfaceLanguage === 'zh-Hans'
          ? {
              keywords: '关键词', whyCorrect: `为什么选 ${correctChoice}`, trap: '陷阱检查',
              related: '延伸考点', tip: '考试提醒', whyWrong: '错误原因',
              correctAnswer: '正确答案', choiceAnalysis: '选项分析',
            }
          : {
              keywords: 'Keywords', whyCorrect: `Why ${correctChoice} is correct`, trap: 'Trap check',
              related: 'Related testable rules', tip: 'Exam tip', whyWrong: 'Why your answer is wrong',
              correctAnswer: 'Correct answer', choiceAnalysis: 'Choice analysis',
            };

    const structureInstruction = isCorrect
      ? `The student answered correctly. Write practical feedback with this exact structure:
## ${h.keywords}
- List the decisive words, dates, relationships, or procedural posture from the English question.
## ${h.whyCorrect}
- Explain the legal reason this answer is correct, tied to the source explanation.
## ${h.trap}
- Identify tempting traps or facts that could mislead the student, and why they do not change the result.
## ${h.related}
- Identify 1-2 closely related MBE rules or variations that could be tested next.
## ${h.tip}
- Give one concise MBE takeaway.`
      : `The student answered incorrectly. Write practical feedback with this exact structure:
## ${h.whyWrong}
- Explain why selected choice ${selectedChoice} is wrong, tied directly to the facts.
## ${h.correctAnswer}
- Explain why choice ${correctChoice} is correct, using the source explanation.
## ${h.choiceAnalysis}
- Analyze every answer choice A-D. For each choice, state whether it is correct or incorrect and the precise legal reason.
## ${h.keywords}
- List the decisive words, dates, relationships, or procedural posture from the English question.
## ${h.trap}
- Identify the trap that likely caused the mistake.
## ${h.related}
- Identify 1-2 closely related MBE rules or variations that could be tested next.
## ${h.tip}
- Give one concise MBE takeaway.`;

    return `You are PassBar's MBE tutor. Analyze this exact single MBE question, not the overall study session.

${languageInstruction}

Use only these inputs: the English question, answer choices, correct answer, selected answer, and source English HTML explanation text.

Question topic: ${input.topic ?? 'Unknown'}
Question:
${this.trimText(input.questionText, 2200)}

Options:
${options}

Student selected: ${selectedChoice}
Correct answer: ${correctChoice}

Source English explanation excerpt:
${this.trimText(input.explanationText ?? '', 3200)}

${structureInstruction}

Use Markdown. Keep it focused on this question. Do not mention that you are an AI model.`;
  }

  private async callGemini(model: string, prompt: string, key: string, jsonOutput = false): Promise<string> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        key,
      )}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(PER_MODEL_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 3600,
            // 診斷結果由前端 JSON.parse，強制模型只輸出 JSON，避免夾帶開場白或 markdown 圍欄
            ...(jsonOutput ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
    );

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.error?.message ?? `Gemini request failed with ${response.status}`;
      throw new Error(message);
    }

    const text = json?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? '')
      .join('')
      .trim();

    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
  }

  async getStatus() {
    const key = this.getApiKey();
    return {
      action: 'status',
      enabled: Boolean(key),
      model: key ? this.getModelsToTry()[0] : null,
    };
  }

  async generateFeedback(input: GeminiFeedbackRequestDto) {
    const key = this.getApiKey();
    if (!key) {
      throw new InternalServerErrorException('Gemini API key is not configured.');
    }

    const prompt =
      input.action === 'question-analysis'
        ? this.buildQuestionAnalysisPrompt(input)
        : input.action === 'performance-diagnosis'
          ? this.buildPerformanceDiagnosisPrompt(input)
          : this.buildPrompt(input);

    const errors: string[] = [];

    const jsonOutput = input.action === 'performance-diagnosis';
    const startedAt = Date.now();

    for (const model of this.getModelsToTry()) {
      if (Date.now() - startedAt > OVERALL_DEADLINE_MS) {
        errors.push(`skipped ${model}: overall deadline exceeded`);
        continue;
      }
      try {
        const feedback = await this.callGemini(model, prompt, key, jsonOutput);
        return { action: input.action ?? 'feedback', feedback, model };
      } catch (error) {
        const message =
          error instanceof Error && error.name === 'TimeoutError'
            ? `no response within ${PER_MODEL_TIMEOUT_MS / 1000}s (model hung)`
            : error instanceof Error
              ? error.message
              : String(error);
        errors.push(`${model}: ${message}`);
      }
    }

    throw new BadGatewayException({
      message: 'Unable to generate Gemini feedback.',
      details: errors.join('\n'),
    });
  }
}
