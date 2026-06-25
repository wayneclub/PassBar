# PassBar

PassBar is a full-stack bar exam study app built around an MBE-style question
bank. It helps learners create focused practice sessions, simulate timed exams,
review missed questions, and turn performance data into a daily study plan.

## Features

- Custom practice sets by subject, chapter, question status, and session mode
- Timed simulated exams and tutor-mode practice
- English and Chinese question content with detailed explanations
- Review queues, bookmarks, answer history, and spaced repetition
- Performance breakdowns by subject, concept, and recurring mistake pattern
- Daily tasks, study planning, calendar integration, and progress tracking
- AI-assisted question analysis and explanation tooling
- User, question-report, and feedback administration

## Tech Stack

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS
- **Backend:** NestJS, PostgreSQL, Drizzle ORM
- **Authentication:** external `auth-service` using Google OAuth and JWT
- **AI tooling:** Genkit, Google GenAI, OpenAI, and optional CLI providers

## Repository Structure

```text
PassBar/
├── .github/workflows/ CI/CD pipeline (test, build, publish, deploy)
├── frontend/        Next.js web application
├── backend/         NestJS API, database schema, migrations, and import tools
├── questions/       Source question files
├── out/             Generated enriched question data
├── scripts/         Question-processing and AI batch tools
└── infra/           Deployment configuration (maintainer use)
```

## Requirements

- Node.js 24 or newer
- npm
- PostgreSQL
- A running PassBar `auth-service` instance for sign-in

## Local Development

Install all workspace dependencies from the repository root:

```bash
npm install
```

Create the shared local environment file:

```bash
cp .env.example .env.local
```

At minimum, configure `DATABASE_URL`, `JWT_SECRET`, and `SERVICE_SECRET`.
`JWT_SECRET` and `SERVICE_SECRET` must match the values used by `auth-service`.
The example configuration expects:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- Auth service: `http://localhost:4010`

Apply the database migrations:

```bash
npm --workspace backend run db:migrate
```

Start the backend and frontend in separate terminals:

```bash
npm --workspace backend run start:dev
```

```bash
npm --workspace frontend run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Files

Application settings are shared through the root `.env.local` file. Browser
variables use the `NEXT_PUBLIC_` prefix and must never contain secrets.

Batch and AI scripts use a separate file:

```bash
cp .env.tools.example .env.tools.local
```

Do not create environment files inside `backend/`, `frontend/`, or `scripts/`.
Never commit credentials, API keys, JWT secrets, or database passwords.

## Question Bank Import

The importer reads canonical `*_enriched.json` files from `out/` by default and
writes them directly to PostgreSQL.

Preview an import without changing the database:

```bash
cd backend
DRY_RUN=true npm run import:questions
```

Run the import:

```bash
cd backend
npm run import:questions
```

Use `QUESTIONS_OUT_DIR` in `.env.local` to read from another directory. A
specific subject or chapter can also be selected:

```bash
cd backend
npm run import:questions -- --subject "Contracts"
npm run import:questions -- --chapter "Offer and Acceptance"
```

The enriched JSON files are the source of truth for imported question content.

## Useful Commands

```bash
# Frontend
npm --workspace frontend run typecheck
npm --workspace frontend run lint
npm --workspace frontend run build

# Backend
npm --workspace backend run test
npm --workspace backend run test:e2e
npm --workspace backend run build

# Database
npm --workspace backend run db:generate
npm --workspace backend run db:migrate
```

## Generated Files

Dependencies, build output, local environment files, question ZIP archives, and
generated question images are excluded from Git. JSON question data remains
trackable because it is used by the import pipeline.
