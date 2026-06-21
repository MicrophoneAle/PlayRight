import type { ParseMusicXmlResult } from '../../types/index.ts';
import { MusicXMLIngestor } from './MusicXMLIngestor.ts';
import { MusicXMLMapper } from './MusicXMLMapper.ts';
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
    const { elements: flat, warnings: normalizeWarnings } =
      MusicXMLNormalizer.normalize(raw);
    const canonicalDivisionsPerQuarter = resolveCanonicalDivisionsPerQuarter(flat);
    const { tempoBpm } = extractScoreTiming(raw);
    const mapped = MusicXMLMapper.mapToDomain(flat, canonicalDivisionsPerQuarter);
    const script = MusicXMLValidator.validate(mapped);

    return {
      script,
      scoreTiming: {
        divisionsPerQuarter: canonicalDivisionsPerQuarter,
        tempoBpm,
      },
      warnings: [...warnings, ...normalizeWarnings],
    };
  }
}

export function parseMusicXmlToScript(rawXml: string): ParseMusicXmlResult {
  return MusicXMLParser.parse(rawXml);
}

export { MusicXMLIngestor, MusicXMLMapper, MusicXMLNormalizer, MusicXMLValidator };
