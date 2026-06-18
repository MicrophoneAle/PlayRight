import type { Finger, ManualFingeringMap } from '../types/index.ts';
import { fingeringKey, isFinger } from '../types/index.ts';
import { getSupabase } from './supabaseClient.ts';

export interface SavedScore {
  id: string;
  title: string;
  raw_xml: string;
  manual_fingerings: ManualFingeringMap;
  created_at: string;
  user_id: string;
}

export interface LibraryEntry {
  id: string;
  title: string;
  created_at: string;
}

function parseManualFingerings(value: unknown): ManualFingeringMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const overrides: ManualFingeringMap = {};

  for (const [key, finger] of Object.entries(value)) {
    if (typeof key !== 'string' || typeof finger !== 'number' || !isFinger(finger)) {
      continue;
    }

    const parts = key.split(':');
    if (parts.length !== 3) {
      continue;
    }

    const stepIndex = Number(parts[0]);
    const hand = parts[1];
    const midi = Number(parts[2]);

    if (
      !Number.isInteger(stepIndex) ||
      stepIndex < 0 ||
      (hand !== 'L' && hand !== 'R') ||
      !Number.isInteger(midi)
    ) {
      continue;
    }

    overrides[fingeringKey(stepIndex, hand, midi)] = finger as Finger;
  }

  return overrides;
}

export async function saveScoreToLibrary(
  title: string,
  rawXml: string,
  userId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, reason: 'Score library is not configured.' };
  }

  const { data, error } = await supabase
    .from('scores')
    .insert({
      title,
      raw_xml: rawXml,
      user_id: userId,
      manual_fingerings: {},
    })
    .select('id')
    .single();

  if (error) {
    console.error('[scoreLibrary] Failed to save score:', error.message);
    return { ok: false, reason: error.message };
  }

  return { ok: true, id: data.id };
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
    .select('id, title, raw_xml, manual_fingerings, created_at, user_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('[scoreLibrary] Failed to fetch score:', error.message);
    return null;
  }

  return {
    ...data,
    manual_fingerings: parseManualFingerings(data.manual_fingerings),
  };
}

export async function updateScoreManualFingerings(
  id: string,
  userId: string,
  manualFingerings: ManualFingeringMap,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, reason: 'Score library is not configured.' };
  }

  const { data, error } = await supabase
    .from('scores')
    .update({ manual_fingerings: manualFingerings })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    console.error('[scoreLibrary] Failed to update manual fingerings:', error.message);
    return { ok: false, reason: error.message };
  }

  if (!data?.length) {
    const reason =
      'Update was blocked (no rows changed). Enable Clerk in Supabase and run supabase/scores_rls.sql.';
    console.error('[scoreLibrary]', reason);
    return { ok: false, reason };
  }

  return { ok: true };
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
