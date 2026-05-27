import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const authToken = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;

if (!supabaseUrl || !anonKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}

const response = await fetch(`${supabaseUrl}/functions/v1/gemini-feedback`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify({
    action: 'question-analysis',
    interfaceLanguage: 'zh-Hant',
    topic: 'Contracts',
    questionText: 'A buyer mailed an offer. The seller mailed an acceptance before receiving a revocation.',
    options: [
      { key: 'A', text: 'No contract because the offer was revoked first.' },
      { key: 'B', text: 'A contract formed when the acceptance was mailed.' },
    ],
    selectedChoice: 'B',
    correctChoice: 'B',
    isCorrect: true,
    explanationText: 'Under the mailbox rule, an acceptance is effective upon dispatch unless the offer provides otherwise.',
  }),
});

const body = await response.json().catch(async () => ({ raw: await response.text() }));
console.log(JSON.stringify({
  status: response.status,
  ok: response.ok,
  action: body.action,
  code: body.code,
  message: body.message,
  model: body.model,
  error: body.error,
  details: body.details,
  feedbackPreview: body.feedback ? String(body.feedback).slice(0, 500) : null,
}, null, 2));

if (response.status === 401) {
  console.error('\nEdge Function requires a valid Supabase user JWT. Run this check from an authenticated browser session, or deploy with --no-verify-jwt if you intentionally want this function callable before login.');
  process.exit(3);
}

if (body.action !== 'question-analysis') {
  console.error('\nEdge Function is stale or routing question-analysis incorrectly.');
  process.exit(2);
}
