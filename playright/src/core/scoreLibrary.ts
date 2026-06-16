import { getSupabase } from './supabaseClient.ts';

export interface SavedScore {
  id: string;
  title: string;
  raw_xml: string;
  created_at: string;
}

export async function saveScoreToLibrary(title: string, rawXml: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('scores').insert({ title, raw_xml: rawXml });

  if (error) {
    console.error('[scoreLibrary] Failed to save score:', error.message);
  }
}
