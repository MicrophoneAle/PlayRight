import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type TokenGetter = () => Promise<string | null>;

let client: SupabaseClient | null = null;
let tokenGetter: TokenGetter = async () => null;

export function configureSupabaseAuth(getter: TokenGetter): void {
  tokenGetter = getter;
}

export function getSupabase(): SupabaseClient | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars.');
    return null;
  }

  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      accessToken: async () => tokenGetter(),
    });
  }

  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}
