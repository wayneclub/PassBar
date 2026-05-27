type FeedbackAttempt = {
  subject?: string;
  topic?: string;
  questionText?: string;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  isCorrect?: boolean;
  timeSpentSeconds?: number | null;
};

type FeedbackRequest = {
  action?: 'status' | 'feedback' | 'question-analysis';
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
  explanationImageUrls?: string[];
  topic?: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const fallbackModels = ['gemini-2.5-flash'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function apiKey() {
  return Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_GENAI_API_KEY') || '';
}

function modelsToTry() {
  const preferred = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash';
  return Array.from(new Set([preferred, ...fallbackModels]));
}

function trimText(value: string | undefined, maxLength = 900) {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function buildPrompt(input: FeedbackRequest) {
  const attempts = (input.attempts ?? []).slice(0, 80);
  const correct = attempts.filter((attempt) => attempt.isCorrect).length;
  const incorrect = attempts.filter((attempt) => attempt.isCorrect === false).length;
  const languageInstruction = input.interfaceLanguage === 'zh-Hant'
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
${attempts.map((attempt, index) => `Question ${index + 1}
Subject: ${attempt.subject ?? 'Unknown'}
Chapter: ${attempt.topic ?? 'Unknown'}
Selected: ${attempt.selectedChoice ?? 'N/A'}
Correct: ${attempt.correctChoice ?? 'N/A'}
Result: ${attempt.isCorrect ? 'Correct' : 'Incorrect'}
Time spent: ${attempt.timeSpentSeconds ?? 'unknown'} seconds
Question excerpt: ${trimText(attempt.questionText)}
`).join('\n')}

Return the feedback in this structure:
1. Overall diagnosis in 2-3 sentences.
2. Strengths.
3. Weak areas by subject/chapter.
4. Concrete next study plan for the next practice session.
5. Timing advice if time data is available.

Do not mention that you are an AI model. Keep it practical and study-focused.`;
}

function buildQuestionAnalysisPrompt(input: FeedbackRequest) {
  const languageInstruction = input.interfaceLanguage === 'zh-Hant'
    ? 'Respond in Traditional Chinese.'
    : input.interfaceLanguage === 'zh-Hans'
      ? 'Respond in Simplified Chinese.'
      : 'Respond in English.';

  const selected = input.selectedChoice ?? 'N/A';
  const correct = input.correctChoice ?? 'N/A';
  const isCorrect = typeof input.isCorrect === 'boolean'
    ? input.isCorrect
    : Boolean(input.selectedChoice && input.correctChoice && input.selectedChoice === input.correctChoice);
  const options = (input.options ?? [])
    .map((option) => `${option.key}. ${trimText(option.text, 700)}`)
    .join('\n');

  const structureInstruction = isCorrect
    ? `The student answered correctly. Write practical feedback with this exact structure:
## 關鍵字
- List the decisive words, dates, relationships, or procedural posture from the English question.
## 為什麼選 ${correct}
- Explain the legal reason this answer is correct, tied to the source explanation.
## 陷阱檢查
- Identify tempting traps or facts that could mislead the student, and why they do not change the result.
## 延伸考點
- Identify 1-2 closely related MBE rules or variations that could be tested next.
## 考試提醒
- Give one concise MBE takeaway.`
    : `The student answered incorrectly. Write practical feedback with this exact structure:
## 錯誤原因
- Explain why selected choice ${selected} is wrong, tied directly to the facts.
## 正確答案
- Explain why choice ${correct} is correct, using the source explanation.
## 選項分析
- Analyze every answer choice A-D. For each choice, state whether it is correct or incorrect and the precise legal reason.
## 關鍵字
- List the decisive words, dates, relationships, or procedural posture from the English question.
## 陷阱檢查
- Identify the trap that likely caused the mistake.
## 延伸考點
- Identify 1-2 closely related MBE rules or variations that could be tested next.
## 考試提醒
- Give one concise MBE takeaway.`;

  return `You are PassBar's MBE tutor. Analyze this exact single MBE question, not the overall study session.

${languageInstruction}

Use only these inputs: the English question, answer choices, correct answer, selected answer, source English explanation/OCR, and any attached source explanation images. Treat attached images as authoritative source explanation material.

Question topic: ${input.topic ?? 'Unknown'}
Question:
${trimText(input.questionText, 2200)}

Options:
${options}

Student selected: ${selected}
Correct answer: ${correct}

Source English explanation or OCR excerpt:
${trimText(input.explanationText ?? '', 3200)}

${structureInstruction}

Use Markdown. Keep it focused on this question. Do not mention that you are an AI model.`;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

async function imageUrlToPart(url: string): Promise<GeminiPart | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? 'image/png';
    if (!contentType.startsWith('image/')) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 7_000_000) return null;
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return {
      inlineData: {
        mimeType: contentType,
        data: btoa(binary),
      },
    };
  } catch {
    return null;
  }
}

async function buildGeminiParts(input: FeedbackRequest, prompt: string): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [{ text: prompt }];
  if (input.action !== 'question-analysis') return parts;

  const imageParts = await Promise.all(
    (input.explanationImageUrls ?? []).slice(0, 2).map((url) => imageUrlToPart(url)),
  );
  imageParts.filter((part): part is GeminiPart => Boolean(part)).forEach((part) => parts.push(part));
  return parts;
}

async function callGemini(model: string, parts: GeminiPart[], key: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 3600,
      },
    }),
  });

  const responseJson = await response.json().catch(() => null);
  if (!response.ok) {
    const message = responseJson?.error?.message ?? `Gemini request failed with ${response.status}`;
    throw new Error(message);
  }

  const text = responseJson?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? '')
    .join('')
    .trim();

  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const key = apiKey();
  const input = (await request.json().catch(() => ({}))) as FeedbackRequest;

  if (input.action === 'status') {
    return json({
      action: 'status',
      enabled: Boolean(key),
      model: key ? modelsToTry()[0] : null,
    });
  }

  if (!key) return json({ error: 'Gemini API key is not configured.' }, 500);

  const prompt = input.action === 'question-analysis'
    ? buildQuestionAnalysisPrompt(input)
    : buildPrompt(input);
  const parts = await buildGeminiParts(input, prompt);
  const errors: string[] = [];

  for (const model of modelsToTry()) {
    try {
      const feedback = await callGemini(model, parts, key);
      return json({ action: input.action ?? 'feedback', feedback, model });
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return json({
    error: 'Unable to generate Gemini feedback.',
    details: errors.join('\n'),
  }, 502);
});
