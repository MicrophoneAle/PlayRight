import { XMLParser, type X2jOptions } from 'fast-xml-parser';

const parserConfig: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  preserveOrder: true,
};

export class MusicXMLIngestor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Phase 1 returns raw parsed tree
  static ingest(xmlString: string): any {
    const trimmed = xmlString.trim();

    if (trimmed.length === 0) {
      throw new Error('[MusicXMLIngestor] Cannot ingest an empty XML string.');
    }

    const parser = new XMLParser(parserConfig);

    try {
      return parser.parse(trimmed);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown parse failure';
      throw new Error(`[MusicXMLIngestor] Failed to parse MusicXML: ${message}`, {
        cause: error,
      });
    }
  }
}
