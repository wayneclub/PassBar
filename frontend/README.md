# PassBar Frontend

Next.js frontend for PassBar.

```bash
npm install
cp ../.env.example ../.env.local
npm run dev
```

The app reads questions and user data from the NestJS backend (`NEXT_PUBLIC_API_URL`, default `http://localhost:4000`) and authenticates via `auth-service` (`NEXT_PUBLIC_AUTH_SERVICE_URL`, default `http://localhost:4010`).
