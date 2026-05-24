# PassBar Frontend

Next.js frontend for PassBar.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app reads questions from Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are configured. Without those values, it falls back to local mock data.
