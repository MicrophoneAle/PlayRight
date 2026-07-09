import type { ParseMusicXmlResult } from '../../types/index.ts';
import { MusicXMLIngestor } from './MusicXMLIngestor.ts';
import { MusicXMLMapper, mergePlaybackScripts } from './MusicXMLMapper.ts';
import {
  assertSupportedScoreFormat,
  collectParseWarnings,
} from './MusicXMLParseChecks.ts';
import { extractScoreTiming, MusicXMLNormalizer, resolveCanonicalDivisionsPerQuarter } from './MusicXMLNormalizer.ts';
import { MusicXMLValidator } from './MusicXMLValidator.ts';

export class MusicXMLParser {
  static parse(xmlString: string): ParseMusicXmlResult {
    const raw = MusicXMLIngestor.ingest(xmlString);
    assertSupportedScoreFormat(raw);
    const warnings = collectParseWarnings(raw);
    const { partElements, warnings: normalizeWarnings } =
      MusicXMLNormalizer.normalize(raw);
    const flatElements = partElements.flat();
    const canonicalDivisionsPerQuarter = resolveCanonicalDivisionsPerQuarter(flatElements);
    const { tempoBpm } = extractScoreTiming(raw);
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

    return {
      script,
      scoreTiming: {
        divisionsPerQuarter: canonicalDivisionsPerQuarter,
        tempoBpm,
        totalTimelineDivisions,
      },
      warnings: [...warnings, ...normalizeWarnings],
    };
  }
}

export function parseMusicXmlToScript(rawXml: string): ParseMusicXmlResult {
  return MusicXMLParser.parse(rawXml);
}

export { MusicXMLIngestor, MusicXMLMapper, MusicXMLNormalizer, MusicXMLValidator };
