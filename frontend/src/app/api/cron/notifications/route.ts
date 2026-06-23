import { NextRequest, NextResponse } from 'next/server';
import { apiUrl } from '@/lib/api';

/**
 * Thin proxy: the actual notification logic now lives server-side in the NestJS
 * backend (POST /internal/cron/notifications), guarded by a shared CRON_SECRET
 * header rather than a user JWT, since this route runs server-to-server with no
 * end-user session. Kept as a GET here so existing Vercel Cron / external cron
 * trigger configs pointing at this Next.js route keep working unchanged.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const res = await fetch(apiUrl('/internal/cron/notifications'), {
      method: 'POST',
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[cron/notifications] proxy failed:', err);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}
