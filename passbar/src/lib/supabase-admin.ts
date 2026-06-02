import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Server-side only (API routes / Server Actions)
const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = supabaseUrl && serverKey
  ? createClient(supabaseUrl, serverKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Client-side dev-only bypass (NEXT_PUBLIC_, only set in .env.local, gitignored)
const devKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdminClient = supabaseUrl && devKey
  ? createClient(supabaseUrl, devKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
