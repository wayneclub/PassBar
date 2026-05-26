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
  action?: 'status' | 'feedback';
  mode?: string;
  totalQuestions?: number;
  attempts?: FeedbackAttempt[];
  unansweredCount?: number;
  interfaceLanguage?: string;
  questionText?: string;
  options?: Array<{ key: string; text: string }>;
  selectedChoice?: string | null;
  correctChoice?: string | null;
  explanationText?: string | null;
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
  const options = (input.options ?? [])
    .map((option) => `${option.key}. ${trimText(option.text, 700)}`)
    .join('\n');

  return `You are PassBar's MBE tutor. Help the student fully understand this single question.

${languageInstruction}

Question topic: ${input.topic ?? 'Unknown'}
Question:
${trimText(input.questionText, 2200)}

Options:
${options}

Student selected: ${selected}
Correct answer: ${correct}

Source explanation or OCR excerpt:
${trimText(input.explanationText ?? '', 2400)}

Write concise but complete feedback with this structure:
1. Why the selected answer is wrong, tied directly to the facts.
2. Why the correct answer is right.
3. Key words or facts the student should have noticed.
4. Test-taking takeaway for similar MBE questions.

Use bullets. Do not mention that you are an AI model.`;
}

async function callGemini(model: string, prompt: string, key: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1400,
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
      enabled: Boolean(key),
      model: key ? modelsToTry()[0] : null,
    });
  }

  if (!key) return json({ error: 'Gemini API key is not configured.' }, 500);

  const prompt = input.action === 'question-analysis'
    ? buildQuestionAnalysisPrompt(input)
    : buildPrompt(input);
  const errors: string[] = [];

  for (const model of modelsToTry()) {
    try {
      const feedback = await callGemini(model, prompt, key);
      return json({ feedback, model });
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return json({
    error: 'Unable to generate Gemini feedback.',
    details: errors.join('\n'),
  }, 502);
});
