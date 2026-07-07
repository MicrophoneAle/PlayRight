/** Acciaccatura (slash) immediately before a main quarter — onset must not advance. */
export const ACCIACCATURA_BEFORE_MAIN_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <duration>480</duration>
        <type>quarter</type>
      </note>
      <note>
        <grace slash="yes"/>
        <pitch><step>C</step><octave>5</octave></pitch>
        <type>32nd</type>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

/** Same score without the grace — baseline for onset-unchanged assertions. */
export const ACCIACCATURA_BASELINE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <duration>480</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

/** Appoggiatura (no slash) before a main quarter. */
export const APPOGGIATURA_BEFORE_MAIN_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <duration>480</duration>
        <type>quarter</type>
      </note>
      <note>
        <grace steal-time-following="yes"/>
        <pitch><step>D</step><octave>5</octave></pitch>
        <type>eighth</type>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
