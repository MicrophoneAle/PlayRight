import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) {
    return client;
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars.');
    return null;
  }

  client = createClient(supabaseUrl, supabaseAnonKey);
  return client;
}
