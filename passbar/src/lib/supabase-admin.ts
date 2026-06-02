import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Server-side only — never included in browser bundle (no NEXT_PUBLIC prefix)
export const supabaseAdmin = supabaseUrl && serverKey
  ? createClient(supabaseUrl, serverKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
