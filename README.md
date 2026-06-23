# PassBar

PassBar is a bar exam practice app for building custom MBE-style question sets, taking tutor or timed sessions, and reviewing explanations.

## Stack

- Next.js frontend in `frontend/`
- NestJS backend in `backend/` (business logic + Postgres via Drizzle)
- `auth-service` (separate repo) — Google OAuth + JWT issuance, shared by PassBar and future products
- Genkit/Google GenAI for explanation generation helpers
- Local JSON exports in `questions/` for import and backup

## Local Setup

```bash
cd backend && npm install && cp .env.example .env && npm run start:dev
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

Open `http://localhost:3000`. The frontend talks to the backend at `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`) and to `auth-service` at `NEXT_PUBLIC_AUTH_SERVICE_URL` (default `http://localhost:4010`) for login.

Do not commit real `.env` files or service role keys.

## Question Bank Import

Imports the local JSON question files in `questions/` directly into Postgres:

```bash
cd backend
DATABASE_URL=postgresql://... npm run import:questions
```

## Git Hygiene

Large generated artifacts are ignored:

- `frontend/node_modules/`, `backend/node_modules/`
- `frontend/.next/`, `backend/dist/`
- `questions/**/*.zip`
- `questions/**/*.png`
- `.env*`

The JSON question exports remain trackable because they are the source data for `import:questions`.
