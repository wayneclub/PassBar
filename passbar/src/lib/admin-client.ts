import { supabase } from './supabase';
import { supabaseAdminClient } from './supabase-admin';

// Use service-role client when mock auth is active (dev only, key in .env.local)
// Otherwise use regular supabase with real user's JWT + RLS
export function getAdminDb() {
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK_AUTH === 'true';
  return (useMock && supabaseAdminClient) ? supabaseAdminClient : supabase;
}
