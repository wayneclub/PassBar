import { Inject, Injectable, InternalServerErrorException, BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Allow, IsIn, IsOptional } from 'class-validator';
import { desc, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider';
import { aiDiagnoses } from '../db/schema';

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

// ⚠ main.ts 的 ValidationPipe 開了 whitelist: true——DTO 欄位「必須」加 class-validator
// decorator（至少 @Allow()），否則整個欄位會被剝掉，controller 只會收到空物件。
export class GeminiFeedbackRequestDto {
  @IsOptional()
  @IsIn(['status', 'feedback', 'question-analysis', 'performance-diagnosis'])
  action?: 'status' | 'feedback' | 'question-analysis' | 'performance-diagnosis';

  @Allow() mode?: string;
  @Allow() totalQuestions?: number;
  @Allow() attempts?: FeedbackAttempt[];
  @Allow() unansweredCount?: number;
  @Allow() interfaceLanguage?: string;
  @Allow() questionText?: string;
  @Allow() options?: Array<{ key: string; text: string }>;
  @Allow() selectedChoice?: string | null;
  @Allow() correctChoice?: string | null;
  @Allow() isCorrect?: boolean;
  @Allow() explanationText?: string | null;
  @Allow() topic?: string | null;
  @Allow() performanceStats?: PerformanceStats;
}

// gemini-3.5-flash 對部分 API key 會回 404/503（見 CLAUDE.md「Gemini API 模型名稱」），
// 失敗時依序退到已確認穩定的模型，避免整個 endpoint 直接 502。
const fallbackModels = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];

// gemini-3.5-flash 過載時可能掛住不回應（而非快速回 503）。反向代理 60 秒就會斷線回 504，
// 所以單一模型最多等 25 秒、整體 50 秒內要試完，確保 fallback 有機會執行並趕在代理逾時前回應。
const PER_MODEL_TIMEOUT_MS = 25_000;
const OVERALL_DEADLINE_MS = 50_000;

// key pool 輪替時，換下一把的觸發狀態：429 額度用完、5xx 過載/內部錯誤、404 該專案未開通此模型、
// 502 空回應。這些換一把（＝換一個專案的免費額度）就有機會成功；400 參數錯誤等換 key 也沒用。
const KEY_ROTATION_STATUSES = new Set([429, 500, 502, 503, 404]);

@Injectable()
export class GeminiFeedbackService {
  private readonly logger = new Logger(GeminiFeedbackService.name);

  // 輪替游標：每次成功後移到下一把，讓請求分散到不同 key，避免總是打第一把先撞 429。
  private keyCursor = 0;

  constructor(
    private readonly configService: ConfigService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** 生成成功後保存診斷（含輸入統計快照），讓使用者重新整理仍看得到，且能對比現況判斷過期。 */
  async saveDiagnosis(
    userId: string,
    feedback: string,
    model: string,
    interfaceLanguage?: string,
    statsSnapshot?: PerformanceStats,
  ) {
    let payload: unknown;
    try {
      payload = JSON.parse(feedback);
    } catch {
      this.logger.warn('Diagnosis feedback is not valid JSON; skipping persistence.');
      return;
    }
    await this.db.insert(aiDiagnoses).values({
      userId,
      payload,
      model,
      interfaceLanguage: interfaceLanguage ?? null,
      statsSnapshot: statsSnapshot ?? null,
    });
  }

  async getLatestDiagnosis(userId: string) {
    const [row] = await this.db
      .select()
      .from(aiDiagnoses)
      .where(eq(aiDiagnoses.userId, userId))
      .orderBy(desc(aiDiagnoses.createdAt))
      .limit(1);
    if (!row) return { payload: null };
    return {
      payload: row.payload,
      model: row.model,
      createdAt: row.createdAt,
      statsSnapshot: row.statsSnapshot,
    };
  }

  /**
   * 取得可用的 API key pool。優先讀 GEMINI_API_KEY_1..N（與批次腳本同款命名，每把對應
   * 一個專案＝一份獨立免費額度），逐把輪替可分散 429、單把掛掉自動跳過。沒設 pool 時退回
   * 單把 GEMINI_API_KEY。
   */
  private getApiKeys(): string[] {
    const pool: string[] = [];
    for (let i = 1; i <= 30; i += 1) {
      const key = this.configService.get<string>(`GEMINI_API_KEY_${i}`);
      if (key) pool.push(key);
    }
    if (pool.length > 0) return pool;
    const single =
      this.configService.get<string>('GEMINI_API_KEY') ||
      this.configService.get<string>('GOOGLE_GENAI_API_KEY') ||
      '';
    return single ? [single] : [];
  }

  private getModelsToTry(): string[] {
    // 預設用已完全 GA、免費額度寬鬆的 gemini-2.5-flash；gemini-3.5-flash 較新、偶發 404/503，
    // 只留在 fallback 清單而不排第一（見 CLAUDE.md「Gemini API 模型名稱」）。
    const preferred = this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
    return Array.from(new Set([preferred, ...fallbackModels]));
  }

  /** 判斷這個錯誤是否值得換下一把 key 重試（key 級的暫時性失敗）。 */
  private shouldTryNextKey(error: unknown): boolean {
    // 模型掛住不回應（TimeoutError）是模型層問題，換 key 沒用——交給外層換更穩的模型。
    if (error instanceof Error && error.name === 'TimeoutError') return false;
    const status = (error as { status?: number }).status;
    if (status === undefined) return false;
    if (KEY_ROTATION_STATUSES.has(status)) return true;
    // 400 多半是參數錯誤（換 key 無用），但「金鑰無效」也回 400——這種要換下一把。
    if (status === 400) {
      const message = (error as Error).message?.toLowerCase() ?? '';
      return message.includes('api key') || message.includes('api_key') || message.includes('permission');
    }
    return false;
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
      const err = new Error(message) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const text = json?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      // 空回應：當成可換 key 重試的暫時性失敗（status 502）。
      const err = new Error('Gemini returned an empty response.') as Error & { status?: number };
      err.status = 502;
      throw err;
    }
    return text;
  }

  async getStatus() {
    const hasKey = this.getApiKeys().length > 0;
    return {
      action: 'status',
      enabled: hasKey,
      model: hasKey ? this.getModelsToTry()[0] : null,
    };
  }

  async generateFeedback(input: GeminiFeedbackRequestDto) {
    const keys = this.getApiKeys();
    if (keys.length === 0) {
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
    const deadlineExceeded = () => Date.now() - startedAt > OVERALL_DEADLINE_MS;

    // 外層換模型（穩定度 fallback），內層換 key（分散免費額度、跳過暫時失敗的那把）。
    for (const model of this.getModelsToTry()) {
      for (let i = 0; i < keys.length; i += 1) {
        if (deadlineExceeded()) {
          errors.push(`skipped ${model}: overall deadline exceeded`);
          break;
        }
        const keyIndex = (this.keyCursor + i) % keys.length;
        try {
          const feedback = await this.callGemini(model, prompt, keys[keyIndex], jsonOutput);
          // 成功：游標推進到下一把，後續請求就從別把開始，平均分散負載。
          this.keyCursor = (keyIndex + 1) % keys.length;
          return { action: input.action ?? 'feedback', feedback, model };
        } catch (error) {
          const message =
            error instanceof Error && error.name === 'TimeoutError'
              ? `no response within ${PER_MODEL_TIMEOUT_MS / 1000}s (model hung)`
              : error instanceof Error
                ? error.message
                : String(error);
          errors.push(`${model} key#${keyIndex + 1}: ${message}`);
          // key 級暫時失敗（429/503/404/金鑰無效）→ 換下一把；否則換 key 也沒用，跳去換模型。
          if (!this.shouldTryNextKey(error)) break;
        }
      }
    }

    throw new BadGatewayException({
      message: 'Unable to generate Gemini feedback.',
      details: errors.join('\n'),
    });
  }
}
