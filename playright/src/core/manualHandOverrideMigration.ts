import type {
  Finger,
  Hand,
  ManualFingeringMap,
  ManualFingeringValue,
  PlaybackScript,
} from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';

/** Legacy localStorage key prefix — kept until historical crossover data has migrated. */
export const MANUAL_HAND_OVERRIDES_PREFIX = 'playright-hand-overrides:';

type LegacyHandOverrideKey = `${number}:${number}`;
type LegacyHandOverrideMap = Partial<Record<LegacyHandOverrideKey, Hand>>;

function resolveFingerFromValue(value: ManualFingeringValue | undefined): Finger | null {
  if (value === undefined) {
    return null;
  }

  return typeof value === 'number' ? value : value.finger;
}

function findNotatedHand(
  script: PlaybackScript,
  onset: number,
  midi: number,
): Hand | null {
  for (const step of script) {
    if (step.onset !== onset) {
      continue;
    }

    for (const note of step.notes) {
      if (note.midi === midi) {
        return note.hand;
      }
    }
  }

  return null;
}

function findFingerForLegacyCrossover(
  script: PlaybackScript,
  onset: number,
  midi: number,
  notatedHand: Hand,
  physicalHand: Hand,
  manualFingerings: ManualFingeringMap,
): Finger | null {
  const correctKey = fingeringKey(onset, notatedHand, midi);
  let finger = resolveFingerFromValue(manualFingerings[correctKey]);
  if (finger !== null) {
    return finger;
  }

  const physicalKey = fingeringKey(onset, physicalHand, midi);
  finger = resolveFingerFromValue(manualFingerings[physicalKey]);
  if (finger !== null) {
    return finger;
  }

  for (const [key, value] of Object.entries(manualFingerings)) {
    const parts = key.split(':');
    if (parts.length !== 3) {
      continue;
    }

    if (Number(parts[0]) === onset && Number(parts[2]) === midi) {
      finger = resolveFingerFromValue(value);
      if (finger !== null) {
        return finger;
      }
    }
  }

  for (const step of script) {
    if (step.onset !== onset) {
      continue;
    }

    for (const note of step.notes) {
      if (note.midi === midi && note.hand === notatedHand && note.finger !== null) {
        return note.finger;
      }
    }
  }

  return null;
}

function crossoverValue(
  finger: Finger,
  notatedHand: Hand,
  physicalHand: Hand,
): ManualFingeringValue {
  return physicalHand === notatedHand
    ? finger
    : { finger, physicalHand };
}

/**
 * Converts legacy onset:midi hand overrides into manual_fingerings crossover entries
 * (onset:notatedHand:midi). Only touches main-note keys — grace notes are not in this map.
 */
export function migrateLegacyHandOverrides(
  script: PlaybackScript,
  manualFingerings: ManualFingeringMap,
  legacyOverrides: LegacyHandOverrideMap,
): { manualFingerings: ManualFingeringMap; migratedCount: number } {
  if (Object.keys(legacyOverrides).length === 0) {
    return { manualFingerings, migratedCount: 0 };
  }

  const migrated = { ...manualFingerings };
  let migratedCount = 0;

  for (const [legacyKey, physicalHand] of Object.entries(legacyOverrides)) {
    if (physicalHand !== 'L' && physicalHand !== 'R') {
      continue;
    }

    const match = /^(\d+):(\d+)$/.exec(legacyKey);
    if (!match) {
      continue;
    }

    const onset = Number(match[1]);
    const midi = Number(match[2]);
    const notatedHand = findNotatedHand(script, onset, midi);
    if (notatedHand === null) {
      continue;
    }

    const correctKey = fingeringKey(onset, notatedHand, midi);
    const existing = migrated[correctKey];
    const existingPhysicalHand =
      typeof existing === 'object' ? existing.physicalHand : notatedHand;

    if (
      existing !== undefined &&
      existingPhysicalHand === physicalHand &&
      resolveFingerFromValue(existing) !== null
    ) {
      migratedCount += 1;
      continue;
    }

    const finger = findFingerForLegacyCrossover(
      script,
      onset,
      midi,
      notatedHand,
      physicalHand,
      migrated,
    );
    if (finger === null) {
      console.warn(
        `[manualHandOverrideMigration] Skipping legacy crossover ${legacyKey} — no finger found`,
      );
      continue;
    }

    migrated[correctKey] = crossoverValue(finger, notatedHand, physicalHand);

    const stalePhysicalKey = fingeringKey(onset, physicalHand, midi);
    if (stalePhysicalKey !== correctKey) {
      delete migrated[stalePhysicalKey];
    }

    migratedCount += 1;
  }

  return { manualFingerings: migrated, migratedCount };
}

export function readLegacyHandOverrides(scoreId: string | null): LegacyHandOverrideMap {
  if (!scoreId || typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(`${MANUAL_HAND_OVERRIDES_PREFIX}${scoreId}`);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: LegacyHandOverrideMap = {};
    for (const [key, hand] of Object.entries(parsed)) {
      if ((hand === 'L' || hand === 'R') && /^\d+:\d+$/.test(key)) {
        result[key as LegacyHandOverrideKey] = hand;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function clearLegacyHandOverrides(scoreId: string | null): void {
  if (!scoreId || typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(`${MANUAL_HAND_OVERRIDES_PREFIX}${scoreId}`);
}

export function migrateLegacyHandOverridesOnLoad(
  script: PlaybackScript,
  manualFingerings: ManualFingeringMap,
  scoreId: string | null,
): { manualFingerings: ManualFingeringMap; didMigrate: boolean } {
  const legacyOverrides = readLegacyHandOverrides(scoreId);
  const { manualFingerings: migrated, migratedCount } = migrateLegacyHandOverrides(
    script,
    manualFingerings,
    legacyOverrides,
  );

  if (migratedCount > 0) {
    clearLegacyHandOverrides(scoreId);
    return { manualFingerings: migrated, didMigrate: true };
  }

  return { manualFingerings, didMigrate: false };
}
