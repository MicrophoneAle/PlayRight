import { getSupabase } from './supabaseClient.ts';

export interface SavedScore {
  id: string;
  title: string;
  raw_xml: string;
  created_at: string;
  user_id: string;
}

export interface LibraryEntry {
  id: string;
  title: string;
  created_at: string;
}

export async function saveScoreToLibrary(
  title: string,
  rawXml: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, reason: 'Score library is not configured.' };
  }

  const { error } = await supabase.from('scores').insert({
    title,
    raw_xml: rawXml,
    user_id: userId,
  });

  if (error) {
    console.error('[scoreLibrary] Failed to save score:', error.message);
    return { ok: false, reason: error.message };
  }

  return { ok: true };
}

export async function fetchScoreLibrary(
  userId: string,
): Promise<LibraryEntry[] | null> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error('[scoreLibrary] Failed to fetch library: Supabase not configured.');
    return null;
  }

  const { data, error } = await supabase
    .from('scores')
    .select('id, title, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[scoreLibrary] Failed to fetch library:', error.message);
    return null;
  }

  return data ?? [];
}

export async function fetchScoreById(
  id: string,
  userId: string,
): Promise<SavedScore | null> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error('[scoreLibrary] Failed to fetch score: Supabase not configured.');
    return null;
  }

  const { data, error } = await supabase
    .from('scores')
    .select('id, title, raw_xml, created_at, user_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('[scoreLibrary] Failed to fetch score:', error.message);
    return null;
  }

  return data;
}

export async function deleteScoreFromLibrary(
  id: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, reason: 'Score library is not configured.' };
  }

  const { data, error } = await supabase
    .from('scores')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    console.error('[scoreLibrary] Failed to delete score:', error.message);
    return { ok: false, reason: error.message };
  }

  if (!data?.length) {
    const reason =
      'Delete was blocked (no rows removed). Enable Clerk in Supabase and run supabase/scores_rls.sql.';
    console.error('[scoreLibrary]', reason);
    return { ok: false, reason };
  }

  return { ok: true };
}
