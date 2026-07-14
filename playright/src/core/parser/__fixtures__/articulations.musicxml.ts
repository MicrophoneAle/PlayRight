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

/** Marcato via MusicXML strong-accent (distinct from plain accent). */
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

/**
 * Extended articulation detection: tenuto, staccatissimo, detached-legato
 * (portato), marcato, plain accent, and tenuto+accent — one note each.
 * Onsets must stay quarter-grid (P0-1 unchanged).
 */
export const ARTICULATIONS_EXTENDED_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
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
            <tenuto/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <staccatissimo/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <detached-legato/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <strong-accent type="up"/>
          </articulations>
        </notations>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <accent/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <tenuto/>
            <accent/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>480</duration>
        <type>quarter</type>
        <notations>
          <articulations>
            <staccato/>
            <strong-accent/>
          </articulations>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;
