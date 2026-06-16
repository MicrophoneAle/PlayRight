import { XMLParser, type X2jOptions } from 'fast-xml-parser';

/** MusicXML tags that must always deserialize as arrays, even when singular. */
const ARRAY_TAGS = new Set(['note', 'measure', 'part', 'score-part']);

const parserConfig: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  isArray: (name, jPathOrMatcher, isLeafNode, isAttribute) => {
    void jPathOrMatcher;
    void isLeafNode;
    void isAttribute;
    return ARRAY_TAGS.has(name);
  },
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

const MOCK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Music</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

console.log('[MusicXMLIngestor] MOCK_XML parse result:', MusicXMLIngestor.ingest(MOCK_XML));
