import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const userId = request.headers.get('x-admin-user-id');
  if (!userId || !supabaseAdmin) return false;
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'admin';
}

export async function GET(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  if (!await verifyAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [{ data: profiles }, { data: active }, { count: sessionCount }] = await Promise.all([
    supabaseAdmin.from('profiles').select('status'),
    supabaseAdmin.from('profiles').select('id').gte('last_seen_at', todayStart.toISOString()),
    supabaseAdmin.from('practice_sessions').select('*', { count: 'exact', head: true }),
  ]);

  const rows = (profiles ?? []) as { status: string }[];
  return NextResponse.json({
    total: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    activeToday: (active ?? []).length,
    totalSessions: sessionCount ?? 0,
  });
}
