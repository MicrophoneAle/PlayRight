import type { PlaybackScript } from '../../types/index.ts';
import { MusicXMLIngestor } from './MusicXMLIngestor.ts';
import { MusicXMLMapper } from './MusicXMLMapper.ts';
import { MusicXMLNormalizer } from './MusicXMLNormalizer.ts';
import { MusicXMLValidator } from './MusicXMLValidator.ts';

export class MusicXMLParser {
  static parse(xmlString: string): PlaybackScript {
    const raw = MusicXMLIngestor.ingest(xmlString);
    const flat = MusicXMLNormalizer.normalize(raw);
    const mapped = MusicXMLMapper.mapToDomain(flat);
    return MusicXMLValidator.validate(mapped);
  }
}

export { MusicXMLIngestor, MusicXMLMapper, MusicXMLNormalizer, MusicXMLValidator };
