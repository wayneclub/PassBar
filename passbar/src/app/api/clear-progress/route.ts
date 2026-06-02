import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  let userId: string;
  try {
    const body = await req.json();
    userId = body.userId;
    if (!userId || typeof userId !== 'string') throw new Error('Missing userId');
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Verify the caller is authenticated as this user via their JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userToken = authHeader.slice(7);
  const userClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user || user.id !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use service role to bypass RLS
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [progressResult, sessionsResult] = await Promise.all([
    admin.from('user_question_progress').delete().eq('user_id', userId),
    admin.from('practice_sessions').delete().eq('user_id', userId),
  ]);

  if (progressResult.error) {
    console.error('[clear-progress] progress error:', progressResult.error.message);
  }
  if (sessionsResult.error) {
    console.error('[clear-progress] sessions error:', sessionsResult.error.message);
  }

  const ok = !progressResult.error && !sessionsResult.error;
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
}
