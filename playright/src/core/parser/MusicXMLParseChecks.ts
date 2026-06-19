type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scorePartwiseChildren(rawXmlObj: unknown[]): unknown[] | null {
  const scorePartwiseEntry = rawXmlObj.find(
    (entry) => isRecord(entry) && entry['score-partwise'] != null,
  );

  if (!isRecord(scorePartwiseEntry) || !Array.isArray(scorePartwiseEntry['score-partwise'])) {
    return null;
  }

  return scorePartwiseEntry['score-partwise'];
}

export function assertSupportedScoreFormat(rawXmlObj: unknown): void {
  if (!Array.isArray(rawXmlObj)) {
    return;
  }

  const hasPartwise = rawXmlObj.some(
    (entry) => isRecord(entry) && entry['score-partwise'] != null,
  );
  const hasTimewise = rawXmlObj.some(
    (entry) => isRecord(entry) && entry['score-timewise'] != null,
  );

  if (hasTimewise && !hasPartwise) {
    throw new Error(
      'This score uses score-timewise MusicXML, which PlayRight does not support. Please re-export the file as score-partwise.',
    );
  }
}

export function collectParseWarnings(rawXmlObj: unknown): string[] {
  if (!Array.isArray(rawXmlObj)) {
    return [];
  }

  const warnings: string[] = [];
  const scorePartwise = scorePartwiseChildren(rawXmlObj);

  if (!scorePartwise) {
    return warnings;
  }

  const partCount = scorePartwise.filter(
    (entry) => isRecord(entry) && entry.part != null,
  ).length;

  if (partCount > 1) {
    warnings.push(
      `This score contains ${partCount} parts. PlayRight currently parses only the first part; notes from the other ${partCount - 1} part(s) are not included.`,
    );
  }

  return warnings;
}
