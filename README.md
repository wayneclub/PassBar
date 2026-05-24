# PassBar

PassBar is a bar exam practice app for building custom MBE-style question sets, taking tutor or timed sessions, and reviewing explanations.

## Stack

- Next.js app in `frontend/`
- Supabase for the question bank
- Genkit/Google GenAI for explanation generation helpers
- Local JSON exports in `questions/` for import and backup

## Local Setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

`frontend/.env.local`:

```bash
GOOGLE_GENAI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

For importing questions, set server-side credentials in your shell:

```bash
export SUPABASE_URL=
export SUPABASE_SERVICE_ROLE_KEY=
```

Do not commit real `.env` files or service role keys.

## Supabase Question Bank

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Import the local JSON question files:

```bash
npm --prefix frontend install
cd frontend
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:questions
```

The app reads from Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are present. If they are missing, it falls back to local mock data so development still works.

## Git Hygiene

Large generated artifacts are ignored:

- `frontend/node_modules/`
- `frontend/.next/`
- `questions/**/*.zip`
- `questions/**/*.png`
- `.env*`

The JSON question exports remain trackable because they are the source data for Supabase imports.
