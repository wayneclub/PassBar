import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const userId = request.headers.get('x-admin-user-id');
  if (!userId || !supabaseAdmin) return false;

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  return data?.role === 'admin';
}

export async function GET(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  if (!await verifyAdmin(request)) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, avatar_url, role, status, last_seen_at, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/users]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ users: data });
}

export async function PATCH(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  if (!await verifyAdmin(request)) return unauthorized();

  const body = await request.json() as { userId: string; status?: string; role?: string };
  if (!body.userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const updates: Record<string, string> = { updated_at: new Date().toISOString() };
  if (body.status) updates.status = body.status;
  if (body.role) updates.role = body.role;

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', body.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
