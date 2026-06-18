import { useAuth } from '@clerk/react';
import { useEffect } from 'react';
import { configureSupabaseAuth } from '../core/supabaseClient.ts';

/** Sends the Clerk session JWT to Supabase so RLS can scope rows per user. */
export function SupabaseClerkBridge() {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    configureSupabaseAuth(async () => {
      try {
        return (await getToken()) ?? null;
      } catch {
        return null;
      }
    });
  }, [getToken, isLoaded]);

  return null;
}
