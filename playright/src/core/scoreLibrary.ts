import { getSupabase } from './supabaseClient.ts';

export interface SavedScore {
  id: string;
  title: string;
  raw_xml: string;
  created_at: string;
}

export interface LibraryEntry {
  id: string;
  title: string;
  created_at: string;
}

export async function saveScoreToLibrary(title: string, rawXml: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error('[scoreLibrary] Failed to save score: Supabase not configured.');
    return;
  }

  const { error } = await supabase.from('scores').insert({ title, raw_xml: rawXml });

  if (error) {
    console.error('[scoreLibrary] Failed to save score:', error.message);
  }
}

export async function fetchScoreLibrary(): Promise<LibraryEntry[] | null> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error('[scoreLibrary] Failed to fetch library: Supabase not configured.');
    return null;
  }

  const { data, error } = await supabase
    .from('scores')
    .select('id, title, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[scoreLibrary] Failed to fetch library:', error.message);
    return null;
  }

  return data ?? [];
}

export async function fetchScoreById(id: string): Promise<SavedScore | null> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error('[scoreLibrary] Failed to fetch score: Supabase not configured.');
    return null;
  }

  const { data, error } = await supabase
    .from('scores')
    .select('id, title, raw_xml, created_at')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[scoreLibrary] Failed to fetch score:', error.message);
    return null;
  }

  return data;
}

export async function deleteScoreFromLibrary(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error('[scoreLibrary] Failed to delete score: Supabase not configured.');
    return false;
  }

  const { error } = await supabase.from('scores').delete().eq('id', id);

  if (error) {
    console.error('[scoreLibrary] Failed to delete score:', error.message);
    return false;
  }

  return true;
}
