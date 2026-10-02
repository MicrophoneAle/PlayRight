/**
 * Synthetic sustain-pedal fixtures. Every measure is 4/4 at divisions=1, so
 * onsets read directly as quarter-note counts from the start of the piece.
 */

const q = (step: string) =>
  `<note><pitch><step>${step}</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>2</staff></note>`;

/** Four quarters C D E F. */
const BAR = [q('C'), q('D'), q('E'), q('F')];

const ped = (type: string, inner = '') =>
  `<direction placement="below"><direction-type><pedal type="${type}" line="yes"/></direction-type>${inner}<staff>2</staff></direction>`;

const ATTRIBUTES = `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;

function part(id: string, measures: string[][], measureExtras: Record<number, string> = {}): string {
  const body = measures
    .map((content, index) => {
      const number = index + 1;
      const attributes = index === 0 ? ATTRIBUTES : '';
      return `<measure number="${number}">${attributes}${measureExtras[number] ?? ''}${content.join('')}</measure>`;
    })
    .join('');
  return `<part id="${id}">${body}</part>`;
}

function score(...parts: string[]): string {
  const ids = [...parts.join('').matchAll(/<part id="([^"]+)"/g)].map((match) => match[1]);
  const partList = ids
    .map((id) => `<score-part id="${id}"><part-name>${id}</part-name></score-part>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list>${partList}</part-list>${parts.join('')}</score-partwise>`;
}

/** Pedal down at 0, `change` at 2, lift at 8 (after the last note). Spans [0,2) and [2,8). */
export const PEDAL_CHANGE_MUSICXML = score(
  part('P1', [
    [ped('start'), q('C'), q('D'), ped('change'), q('E'), q('F')],
    [...BAR, ped('stop')],
  ]),
);

/**
 * Lift-and-redepress written as a separate stop and start at the same onset,
 * with the START first in document order (how constant-moderato and
 * clair-de-lune encode every pedal change). Pairing in document order would
 * open a second span while the first is down. Spans [0,4) and [4,8).
 */
export const PEDAL_START_BEFORE_STOP_SAME_ONSET_MUSICXML = score(
  part('P1', [
    [ped('start'), ...BAR],
    [ped('start'), ped('stop'), ...BAR, ped('stop')],
  ]),
);

/** Pedal down at 0 and never lifted. Must warn and produce no span (not extend to the end). */
export const DANGLING_PEDAL_START_MUSICXML = score(
  part('P1', [[ped('start'), ...BAR], BAR]),
);

/** A lift at 1 with nothing down, then a real span [2,4). */
export const STRAY_PEDAL_STOP_MUSICXML = score(
  part('P1', [[q('C'), ped('stop'), q('D'), ped('start'), q('E'), q('F'), ped('stop')]]),
);

/**
 * tetoris-style start/discontinue, then resume/stop, with a layout-only
 * `continue` inside and a sostenuto mark (not modeled). Spans [0,2), [3,8).
 */
export const PEDAL_DISCONTINUE_RESUME_MUSICXML = score(
  part('P1', [
    [ped('start'), q('C'), q('D'), ped('discontinue'), q('E'), ped('resume'), q('F')],
    [q('C'), ped('continue'), q('D'), ped('sostenuto'), q('E'), q('F'), ped('stop')],
  ]),
);

/** `<offset>` places the depress one quarter after its direction's position. Span [1,4). */
export const PEDAL_OFFSET_MUSICXML = score(
  part('P1', [[ped('start', '<offset>1</offset>'), ...BAR, ped('stop')]]),
);

/** Pedal marks only in the second part (a piano split into RH/LH parts). Span [0,4). */
export const PEDAL_SECOND_PART_ONLY_MUSICXML = score(
  part('P1', [BAR]),
  part('P2', [[ped('start'), ...BAR, ped('stop')]]),
);

/** Two parts disagree: P1 holds [0,2), P2 holds [1,4). Union [0,4) with a warning. */
export const PEDAL_CONFLICTING_PARTS_MUSICXML = score(
  part('P1', [[ped('start'), q('C'), q('D'), ped('stop'), q('E'), q('F')]]),
  part('P2', [[q('C'), ped('start'), q('D'), q('E'), q('F'), ped('stop')]]),
);

/** Both parts carry identical marks (duplicated per staff-part). Span [0,4), no warning. */
export const PEDAL_DUPLICATED_PARTS_MUSICXML = score(
  part('P1', [[ped('start'), ...BAR, ped('stop')]]),
  part('P2', [[ped('start'), ...BAR, ped('stop')]]),
);

/**
 * Pedal down in the last quarter of a repeated section (m2, onset 7) and
 * lifted after the repeat, in m3 (onset 9). Playback order is
 * m1 m2 m1 m2 m3, so the span covers a backward-jump boundary in document
 * order. Span [7,9) in document onsets.
 */
export const PEDAL_ACROSS_REPEAT_MUSICXML = score(
  part(
    'P1',
    [
      BAR,
      [q('C'), q('D'), q('E'), ped('start'), q('F')],
      [q('C'), ped('stop'), q('D'), q('E'), q('F')],
    ],
    {
      1: '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>',
      2: '',
    },
  ).replace(
    '</measure><measure number="3">',
    '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline></measure><measure number="3">',
  ),
);
