import type { ParseMusicXmlResult } from '../../types/index.ts';
import { extractMeasureFlow } from './MeasureFlowNormalizer.ts';
import { MusicXMLIngestor } from './MusicXMLIngestor.ts';
import { MusicXMLMapper, mergePlaybackScripts } from './MusicXMLMapper.ts';
import {
  assertSupportedScoreFormat,
  collectParseWarnings,
} from './MusicXMLParseChecks.ts';
import {
  extractPedalSpans,
  extractScoreTiming,
  MusicXMLNormalizer,
  resolveCanonicalDivisionsPerQuarter,
} from './MusicXMLNormalizer.ts';
import { MusicXMLValidator } from './MusicXMLValidator.ts';
import { resolvePlaybackOrder } from './PlaybackOrderResolver.ts';

export class MusicXMLParser {
  static parse(xmlString: string): ParseMusicXmlResult {
    const raw = MusicXMLIngestor.ingest(xmlString);
    assertSupportedScoreFormat(raw);
    const warnings = collectParseWarnings(raw);
    const { partElements, warnings: normalizeWarnings } =
      MusicXMLNormalizer.normalize(raw);
    const flatElements = partElements.flat();
    const canonicalDivisionsPerQuarter = resolveCanonicalDivisionsPerQuarter(flatElements);
    const { tempoBpm, tempoMap } = extractScoreTiming(raw, canonicalDivisionsPerQuarter);
    // Pedal spans are metadata only: written here, read by nothing yet.
    const { pedalSpans, warnings: pedalWarnings } = extractPedalSpans(
      raw,
      canonicalDivisionsPerQuarter,
    );
    const partMaps = partElements.map((part) =>
      MusicXMLMapper.mapToDomain(part, canonicalDivisionsPerQuarter),
    );
    const mapped =
      partMaps.length <= 1
        ? (partMaps[0]?.script ?? [])
        : mergePlaybackScripts(partMaps.map((partMap) => partMap.script));
    const totalTimelineDivisions = Math.max(
      0,
      ...partMaps.map((partMap) => partMap.finalTimelineDivisions),
    );
    const script = MusicXMLValidator.validate(mapped);
    const flow = extractMeasureFlow(raw);
    const { playbackOrder, warnings: resolveWarnings } = resolvePlaybackOrder({
      script,
      flow,
      firstPartElements: partElements[0] ?? [],
      canonicalDivisionsPerQuarter,
    });

    return {
      script,
      playbackOrder,
      scoreTiming: {
        divisionsPerQuarter: canonicalDivisionsPerQuarter,
        tempoBpm,
        tempoMap,
        totalTimelineDivisions,
        ...(pedalSpans.length > 0 ? { pedalSpans } : {}),
      },
      warnings: [
        ...warnings,
        ...normalizeWarnings,
        ...partMaps.flatMap((partMap) => partMap.warnings),
        ...pedalWarnings,
        ...flow.warnings,
        ...resolveWarnings,
      ],
    };
  }
}

export function parseMusicXmlToScript(rawXml: string): ParseMusicXmlResult {
  return MusicXMLParser.parse(rawXml);
}

export { MusicXMLIngestor, MusicXMLMapper, MusicXMLNormalizer, MusicXMLValidator };
