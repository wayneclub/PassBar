// Dev-only smoke test for /api/gemini-feedback's question-analysis action.
// Run `npm run dev` in another terminal first, then `npm run gemini:check-question`.

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const response = await fetch(`${baseUrl}/api/gemini-feedback/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
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
  error: body.error,
  details: body.details,
  feedbackPreview: body.feedback ? String(body.feedback).slice(0, 500) : null,
}, null, 2));

if (body.action !== 'question-analysis') {
  console.error('\n/api/gemini-feedback is stale or routing question-analysis incorrectly.');
  process.exit(2);
}
