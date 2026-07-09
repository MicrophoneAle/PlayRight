/** Regression fixture: staccato, accent, plain, and combined articulations. */
export const ARTICULATIONS_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <staccato/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <accent/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <staccato/>
            <accent/>
          </articulations>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

/** strong-accent maps to hasAccent the same as accent. */
export const STRONG_ACCENT_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time><beats>1</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <strong-accent/>
          </articulations>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;
