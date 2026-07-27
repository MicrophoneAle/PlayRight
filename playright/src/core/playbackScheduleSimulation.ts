import type { PlaybackScript } from '../types/index.ts';
import {
  buildFermataPlaybackContext,
  buildFinalNoteKeySet,
  buildPlaybackFermataOffsetsByStep,
  PLAYBACK_MAX_WINDOW_LAG_QUARTERS,
  PLAYBACK_SCHEDULE_AHEAD_QUARTERS,
  PLAYBACK_SCHEDULE_EXTENSION_LEAD_QUARTERS,
  quartersToTicks,
  scheduledPlaybackAttackQuarterNotes,
} from './playbackTiming.ts';

const DEFAULT_PPQ = 480;

export interface ScheduledAttackRecord {
  stepIndex: number;
  musicalTick: number;
  scheduledTick: number;
}

export interface PlaybackScheduleSimulationOptions {
  transportPpq?: number;
  /** Simulated transport lead when a rolling-window extension fires late. */
  extensionTransportDriftTicks?: number;
  /** Legacy transport floor at every window (pre-fix). */
  useLegacyTransportFloor?: boolean;
  /** Shift entire window forward when extension runs late (current engine). */
  useWindowLagShift?: boolean;
  /** Cap lag shift (current engine). Default true. */
  useWindowLagCap?: boolean;
  /**
   * Model early-lead extensions: transport is LEAD quarters before the window
   * anchor when the extension runs (plus optional drift). Default false so
   * existing late-extension regressions stay meaningful.
   */
  useEarlyExtensionLead?: boolean;
}

/**
 * Mirrors document-order (identity PlaybackOrder) attack-tick scheduling for
 * regression tests without spinning up Tone transport. Since R1 this is the
 * pre-repeat-unrolling reference. PlaybackEngine must reproduce it tick for
 * tick on every score whose PlaybackOrder is the identity mapping
 * (PlaybackEngine.playback-order.test.ts asserts that equivalence).
 */
export function simulatePlaybackAttackSchedule(
  script: PlaybackScript,
  divisionsPerQuarter: number,
  options: PlaybackScheduleSimulationOptions = {},
): ScheduledAttackRecord[] {
  const ppq = options.transportPpq ?? DEFAULT_PPQ;
  const drift = options.extensionTransportDriftTicks ?? 0;
  const useLegacyTransportFloor = options.useLegacyTransportFloor ?? false;
  const useWindowLagShift = options.useWindowLagShift ?? true;
  const useWindowLagCap = options.useWindowLagCap ?? true;
  const useEarlyExtensionLead = options.useEarlyExtensionLead ?? false;

  const fermataContext = buildFermataPlaybackContext(script, divisionsPerQuarter);
  const finalNoteKeys = buildFinalNoteKeySet(script, divisionsPerQuarter);
  const fermataOffsets = buildPlaybackFermataOffsetsByStep(
    script,
    divisionsPerQuarter,
    finalNoteKeys,
    fermataContext,
  );

  const attacks: ScheduledAttackRecord[] = [];
  let nextUnscheduledStepIndex = 0;
  let lastScheduledAttackTick = -1;
    const maxWindowLagTicks = Math.round(
    quartersToTicks(PLAYBACK_MAX_WINDOW_LAG_QUARTERS, ppq),
  );
  const earlyLeadTicks = Math.round(
    quartersToTicks(PLAYBACK_SCHEDULE_EXTENSION_LEAD_QUARTERS, ppq),
  );

  while (nextUnscheduledStepIndex < script.length) {
    const fromStepIndex = nextUnscheduledStepIndex;
    const anchorQuarters = scheduledPlaybackAttackQuarterNotes(
      script[fromStepIndex].onset,
      divisionsPerQuarter,
      fermataOffsets[fromStepIndex],
    );
    const anchorTick = Math.round(quartersToTicks(anchorQuarters, ppq));
    const windowEndQuarters = anchorQuarters + PLAYBACK_SCHEDULE_AHEAD_QUARTERS;
    // Late extension: transport sits at/after the window anchor (+ drift).
    // Early-lead extension: transport is still LEAD quarters before the anchor
    // when the fill runs, so modest main-thread delay does not create lag.
    const transportNow =
      fromStepIndex === 0
        ? anchorTick
        : useEarlyExtensionLead
          ? anchorTick - earlyLeadTicks + drift
          : anchorTick + drift;

    const rawWindowLagTicks =
      useWindowLagShift && lastScheduledAttackTick >= 0
        ? Math.max(0, transportNow - anchorTick)
        : 0;
    const windowLagTicks = useWindowLagCap
      ? Math.min(rawWindowLagTicks, maxWindowLagTicks)
      : rawWindowLagTicks;

    let lastSafeAttackTick: number;
    if (useLegacyTransportFloor) {
      lastSafeAttackTick = Math.max(lastScheduledAttackTick, transportNow - 1);
    } else {
      lastSafeAttackTick = lastScheduledAttackTick;
      if (lastSafeAttackTick < 0) {
        lastSafeAttackTick = Math.max(-1, transportNow - 1);
      }
    }

    let lastScheduledStep = fromStepIndex;

    for (let stepIndex = fromStepIndex; stepIndex < script.length; stepIndex += 1) {
      const attackOnsetQuarters = scheduledPlaybackAttackQuarterNotes(
        script[stepIndex].onset,
        divisionsPerQuarter,
        fermataOffsets[stepIndex],
      );

      if (stepIndex > fromStepIndex && attackOnsetQuarters > windowEndQuarters) {
        break;
      }

      const musicalTick = Math.round(quartersToTicks(attackOnsetQuarters, ppq));
      const scheduleTarget = musicalTick + windowLagTicks;
      const roundedTarget = Math.round(scheduleTarget);
      const scheduledTick =
        roundedTarget < lastSafeAttackTick ? lastSafeAttackTick + 1 : roundedTarget;

      attacks.push({ stepIndex, musicalTick, scheduledTick });
      lastSafeAttackTick = scheduledTick;
      lastScheduledStep = stepIndex + 1;
    }

    nextUnscheduledStepIndex = lastScheduledStep;
    lastScheduledAttackTick = lastSafeAttackTick;

    if (lastScheduledStep >= script.length || lastScheduledStep === fromStepIndex) {
      break;
    }
  }

  return attacks;
}

/** Inter-step gaps that deviate from the score's musical spacing. */
export function findInterAttackGapMismatches(
  attacks: ScheduledAttackRecord[],
): Array<{
  laterStepIndex: number;
  musicalGap: number;
  scheduledGap: number;
}> {
  const mismatches: Array<{
    laterStepIndex: number;
    musicalGap: number;
    scheduledGap: number;
  }> = [];

  for (let index = 1; index < attacks.length; index += 1) {
    const musicalGap = attacks[index].musicalTick - attacks[index - 1].musicalTick;
    const scheduledGap = attacks[index].scheduledTick - attacks[index - 1].scheduledTick;

    if (musicalGap > 0 && musicalGap !== scheduledGap) {
      mismatches.push({
        laterStepIndex: attacks[index].stepIndex,
        musicalGap,
        scheduledGap,
      });
    }
  }

  return mismatches;
}

export function findAttackScheduleClamps(
  attacks: ScheduledAttackRecord[],
): Array<{
  stepIndex: number;
  musicalTick: number;
  scheduledTick: number;
}> {
  return attacks
    .filter((attack) => attack.scheduledTick !== attack.musicalTick)
    .map((attack) => ({
      stepIndex: attack.stepIndex,
      musicalTick: attack.musicalTick,
      scheduledTick: attack.scheduledTick,
    }));
}

async function loadMxlScoreXml(assetPath: string): Promise<string> {
  const { readFileSync } = await import('node:fs');
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL(assetPath, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) {
    throw new Error(`${assetPath} missing score.xml`);
  }
  return scoreXml;
}

export async function loadTetorisScript() {
  const { parseMusicXmlToScript } = await import('./parser/index.ts');
  const xml = await loadMxlScoreXml('../assets/tetoris.mxl');
  return parseMusicXmlToScript(xml);
}

export async function loadUnwelcomeSchoolScript() {
  const { parseMusicXmlToScript } = await import('./parser/index.ts');
  const xml = await loadMxlScoreXml('../assets/unwelcome-school.mxl');
  return parseMusicXmlToScript(xml);
}
