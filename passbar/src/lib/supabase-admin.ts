import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Server-side only (never exposed to browser bundle)
const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = supabaseUrl && serverKey
  ? createClient(supabaseUrl, serverKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Dev-only client-side bypass (key in .env.local, gitignored)
// Uses a separate storageKey to avoid conflicting with the regular auth client
const devKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdminClient = supabaseUrl && devKey
  ? createClient(supabaseUrl, devKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        storageKey: 'sb-admin-dev',
      },
      global: {
        headers: { Authorization: `Bearer ${devKey}` },
      },
    })
  : null;
