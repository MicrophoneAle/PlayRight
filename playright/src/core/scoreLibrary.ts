import type { ManualFingeringKey, ManualFingeringMap } from '../types/index.ts';
import { fingeringKey, graceFingeringKey, isFinger } from '../types/index.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { pieceEndQuarterNotes, quarterNotesToSecondsWithTempoMap } from './playbackTiming.ts';
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
  /** Playback duration at the score's written tempo; null when XML could not be parsed. */
  durationSeconds: number | null;
  /** Highest measure number in the score; null when XML could not be parsed. */
  measureCount: number | null;
}

const SCORE_SELECT_WITH_FINGERINGS =
  'id, title, raw_xml, manual_fingerings, created_at, user_id';
const SCORE_SELECT_BASE = 'id, title, raw_xml, created_at, user_id';

let loggedMissingManualFingeringsColumn = false;

function warnMissingManualFingeringsColumn(): void {
  if (loggedMissingManualFingeringsColumn) {
    return;
  }

  loggedMissingManualFingeringsColumn = true;
  console.warn(
    '[scoreLibrary] Column scores.manual_fingerings is missing. Run playright/supabase/manual_fingerings.sql in the Supabase SQL Editor. Manual fingering overrides will not persist until then.',
  );
}

function isMissingManualFingeringsColumn(message: string): boolean {
  return message.includes('manual_fingerings');
}

/**
 * Keys are onset:notatedHand:midi for a main note, or
 * onset:notatedHand:midi:g{graceIndex} for a grace note. Values are finger
 * 1–5 or { finger, physicalHand } for crossovers.
 */
export function parseManualFingerings(value: unknown): ManualFingeringMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const overrides: ManualFingeringMap = {};

  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string') {
      continue;
    }

    const parts = key.split(':');
    if (parts.length !== 3 && parts.length !== 4) {
      continue;
    }

    const onset = Number(parts[0]);
    const hand = parts[1];
    const midi = Number(parts[2]);

    if (
      !Number.isInteger(onset) ||
      onset < 0 ||
      (hand !== 'L' && hand !== 'R') ||
      !Number.isInteger(midi)
    ) {
      continue;
    }

    let stableKey: ManualFingeringKey;
    if (parts.length === 4) {
      const graceMatch = /^g(\d+)$/.exec(parts[3]);
      if (!graceMatch) {
        continue;
      }
      stableKey = graceFingeringKey(onset, hand, midi, Number(graceMatch[1]));
    } else {
      stableKey = fingeringKey(onset, hand, midi);
    }

    if (typeof raw === 'number' && isFinger(raw)) {
      overrides[stableKey] = raw;
      continue;
    }

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const finger = (raw as { finger?: unknown }).finger;
      const physicalHand = (raw as { physicalHand?: unknown }).physicalHand;
      if (
        typeof finger === 'number' &&
        isFinger(finger) &&
        (physicalHand === 'L' || physicalHand === 'R')
      ) {
        overrides[stableKey] = { finger, physicalHand };
      }
    }
  }

  return overrides;
}

/** Musical length for library sorting: playback duration with measure-count fallback. */
export function deriveLibraryEntryMetrics(rawXml: string): {
  durationSeconds: number | null;
  measureCount: number | null;
} {
  try {
    const { script, scoreTiming } = parseMusicXmlToScript(rawXml);
    if (script.length === 0) {
      return { durationSeconds: 0, measureCount: 0 };
    }

    const measureCount = script.reduce(
      (max, step) => Math.max(max, step.measureNumber),
      0,
    );
    const endQuarters = pieceEndQuarterNotes(
      script,
      scoreTiming.divisionsPerQuarter,
    );
    const durationSeconds = quarterNotesToSecondsWithTempoMap(
      endQuarters,
      scoreTiming.tempoMap,
      scoreTiming.divisionsPerQuarter,
      scoreTiming.tempoBpm,
    );

    return { durationSeconds, measureCount };
  } catch {
    return { durationSeconds: null, measureCount: null };
  }
}

function mapLibraryRow(row: {
  id: string;
  title: string;
  created_at: string;
  raw_xml: string;
}): LibraryEntry {
  const { durationSeconds, measureCount } = deriveLibraryEntryMetrics(row.raw_xml);
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    durationSeconds,
    measureCount,
  };
}

const scoreLibraryCache = new Map<string, LibraryEntry[]>();

export function readScoreLibraryCache(userId: string): LibraryEntry[] | undefined {
  return scoreLibraryCache.get(userId);
}

export function removeScoreFromLibraryCache(userId: string, scoreId: string): void {
  const cached = scoreLibraryCache.get(userId);
  if (!cached) {
    return;
  }

  scoreLibraryCache.set(
    userId,
    cached.filter((entry) => entry.id !== scoreId),
  );
}

export function invalidateScoreLibraryCache(userId: string): void {
  scoreLibraryCache.delete(userId);
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

  if (error && isMissingManualFingeringsColumn(error.message)) {
    warnMissingManualFingeringsColumn();

    const fallback = await supabase
      .from('scores')
      .insert({
        title,
        raw_xml: rawXml,
        user_id: userId,
      })
      .select('id')
      .single();

    if (fallback.error) {
      console.error('[scoreLibrary] Failed to save score:', fallback.error.message);
      return { ok: false, reason: fallback.error.message };
    }

    invalidateScoreLibraryCache(userId);
    return { ok: true, id: fallback.data.id };
  }

  if (error) {
    console.error('[scoreLibrary] Failed to save score:', error.message);
    return { ok: false, reason: error.message };
  }

  invalidateScoreLibraryCache(userId);
  return { ok: true, id: data.id };
}

export async function fetchScoreLibrary(
  userId: string,
  options: { force?: boolean } = {},
): Promise<LibraryEntry[] | null> {
  if (!options.force) {
    const cached = scoreLibraryCache.get(userId);
    if (cached) {
      return cached;
    }
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error('[scoreLibrary] Failed to fetch library: Supabase not configured.');
    return null;
  }

  const { data, error } = await supabase
    .from('scores')
    .select('id, title, created_at, raw_xml')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[scoreLibrary] Failed to fetch library:', error.message);
    return null;
  }

  const entries = (data ?? []).map((row) => mapLibraryRow(row));
  scoreLibraryCache.set(userId, entries);
  return entries;
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
    .select(SCORE_SELECT_WITH_FINGERINGS)
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error && isMissingManualFingeringsColumn(error.message)) {
    warnMissingManualFingeringsColumn();

    const fallback = await supabase
      .from('scores')
      .select(SCORE_SELECT_BASE)
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fallback.error) {
      console.error('[scoreLibrary] Failed to fetch score:', fallback.error.message);
      return null;
    }

    return {
      ...fallback.data,
      manual_fingerings: {},
    };
  }

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
    if (isMissingManualFingeringsColumn(error.message)) {
      warnMissingManualFingeringsColumn();
      return { ok: false, reason: 'manual_fingerings column missing' };
    }

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

  removeScoreFromLibraryCache(userId, id);
  return { ok: true };
}
