/**
 * Synthetic fixtures for cross-voice ties, cross-staff chords, and unmatched
 * tie-stops (FINDING 6 / FINDING 7).
 */

/** Tie starts in voice 6 and stops in voice 5 (same staff+pitch) — MuseScore reassignment. */
export const CROSS_VOICE_TIE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <staves>1</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>6</voice>
        <staff>1</staff>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>5</voice>
        <staff>1</staff>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

/**
 * Cross-staff chord: C5 on staff 1, then E3 with &lt;chord/&gt; on staff 2,
 * then D5. Correct timeline: [C5,E3]@0 [D5]@4 total=8 (divisions=4).
 */
export const CROSS_STAFF_CHORD_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <staves>2</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

/** Tie-stop with no matching start anywhere — note must survive with a warning. */
export const UNMATCHED_TIE_STOP_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <staves>1</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;
