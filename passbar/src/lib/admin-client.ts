// Admin pages use the regular supabase client with RLS.
// Admins (role='admin') have a policy allowing them to read all profiles.
// For local dev: set NEXT_PUBLIC_USE_MOCK_AUTH=false and sign in with a real admin account.
import { supabase } from './supabase';

export function getAdminDb() {
  return supabase;
}
