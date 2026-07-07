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

function partUsesMultipleStaves(partEntry: RawRecord): boolean {
  if (!Array.isArray(partEntry.part)) {
    return false;
  }

  const staves = new Set<number>();

  for (const measureWrapper of partEntry.part) {
    if (!isRecord(measureWrapper) || !Array.isArray(measureWrapper.measure)) {
      continue;
    }

    for (const child of measureWrapper.measure) {
      if (!isRecord(child) || !Array.isArray(child.note)) {
        continue;
      }

      const noteRecord = orderedChildrenToRecord(child.note);
      if (noteRecord.rest != null || noteRecord.grace != null) {
        continue;
      }

      const staff = toNumber(noteRecord.staff, 1);
      staves.add(staff);
    }
  }

  return staves.size > 1;
}

function orderedChildrenToRecord(children: unknown[]): RawRecord {
  const record: RawRecord = {};

  for (const child of children) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');
    if (tag === undefined) {
      continue;
    }

    record[tag] = child[tag];
  }

  return record;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  if (Array.isArray(value) && value.length > 0) {
    return toNumber(value[0], fallback);
  }

  return fallback;
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

  const partEntries = scorePartwise.filter(
    (entry): entry is RawRecord => isRecord(entry) && entry.part != null,
  );
  const partCount = partEntries.length;

  if (partCount > 2) {
    warnings.push(
      `This score contains ${partCount} parts. PlayRight maps two-part scores to right and left hand; additional parts use staff numbering and hand assignment may not match the score.`,
    );
  }

  if (partCount === 2) {
    const multiStaffParts = partEntries.filter((entry) =>
      partUsesMultipleStaves(entry),
    ).length;

    if (multiStaffParts > 0) {
      warnings.push(
        'This two-part score includes grand staff in one or both parts. PlayRight uses staff numbers within each part for hand assignment instead of mapping part 1 to the right hand and part 2 to the left.',
      );
    }
  }

  return warnings;
}
