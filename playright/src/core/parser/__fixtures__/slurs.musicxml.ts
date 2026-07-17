/** Slur start with no matching stop anywhere in the piece - must warn, never invent legato to end-of-piece. */
export const DANGLING_SLUR_START_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <notations>
          <slur type="start" number="1"/>
        </notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

/**
 * Slur opens on X, spans into a tied pair (A ties into B, same pitch), and
 * the slur STOP tag lands on B - the tie-continuation note that merges into
 * A rather than creating its own ScriptNote. X must resolve to legato (not
 * the last member); the merged note (A, extended by B's duration) must
 * correctly resolve as the slur's true last member, with no phantom entry
 * for B and no incorrect flag on the merged note.
 */
export const SLUR_STOP_ON_TIE_MERGED_NOTE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>240</duration>
        <notations>
          <slur type="start" number="1"/>
        </notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <tie type="start"/>
        <notations>
          <tied type="start"/>
        </notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>240</duration>
        <tie type="stop"/>
        <notations>
          <tied type="stop"/>
          <slur type="stop" number="1"/>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

/**
 * Two staves (one part), each with its own slur under the SAME slur number -
 * the composite (voiceStreamKey, number) key must keep them from
 * cross-contaminating even though the XML number attribute collides.
 */
export const MULTI_VOICE_SLURS_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <staves>2</staves>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>480</duration>
        <staff>1</staff>
        <notations>
          <slur type="start" number="1"/>
        </notations>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>480</duration>
        <staff>1</staff>
        <notations>
          <slur type="stop" number="1"/>
        </notations>
      </note>
      <backup>
        <duration>960</duration>
      </backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>480</duration>
        <staff>2</staff>
        <notations>
          <slur type="start" number="1"/>
        </notations>
      </note>
      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>480</duration>
        <staff>2</staff>
        <notations>
          <slur type="stop" number="1"/>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

/**
 * Slur starts on the first of two graces and stops on the second - both
 * boundaries fall within one grace run, never reaching a main note. Must
 * resolve to an empty main-note range: a correct no-op, not an error.
 */
export const GRACE_TO_GRACE_SLUR_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <grace/>
        <pitch><step>A</step><octave>4</octave></pitch>
        <type>32nd</type>
        <notations>
          <slur type="start" number="1"/>
        </notations>
      </note>
      <note>
        <grace/>
        <pitch><step>B</step><octave>4</octave></pitch>
        <type>32nd</type>
        <notations>
          <slur type="stop" number="1"/>
        </notations>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>480</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

/**
 * Slur starts on a grace before main note X, and stops on a LATER main note
 * Y - the grace boundary delegates forward to X, so X (main notes X..Y-1)
 * connects legato while Y (the phrase-ending note) does not.
 */
export const GRACE_INTO_MAIN_SLUR_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <grace/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <type>32nd</type>
        <notations>
          <slur type="start" number="1"/>
        </notations>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>240</duration>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>240</duration>
        <notations>
          <slur type="stop" number="1"/>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;
