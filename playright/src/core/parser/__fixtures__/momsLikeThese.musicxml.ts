/** Regression fixture: fermata opening, repeated eighths, tied intervals. */
export const MOMS_LIKE_THESE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>4</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>1920</duration>
        <staff>1</staff>
        <notations>
          <fermata type="upright"/>
        </notations>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><alter>1</alter><octave>5</octave></pitch>
        <duration>1920</duration>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>F</step><alter>1</alter><octave>5</octave></pitch>
        <duration>1920</duration>
        <staff>1</staff>
      </note>
      <backup><duration>1920</duration></backup>
      <note>
        <pitch><step>B</step><octave>2</octave></pitch>
        <duration>1920</duration>
        <staff>2</staff>
        <notations>
          <fermata type="upright"/>
        </notations>
      </note>
    </measure>
    <measure number="10">
      <note>
        <pitch><step>D</step><alter>0</alter><octave>5</octave></pitch>
        <duration>240</duration>
        <staff>1</staff>
        <accidental>natural</accidental>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>C</step><alter>1</alter><octave>5</octave></pitch>
        <duration>240</duration>
        <staff>1</staff>
      </note>
    </measure>
    <measure number="11">
      <note>
        <pitch><step>D</step><alter>0</alter><octave>5</octave></pitch>
        <duration>480</duration>
        <staff>1</staff>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
      <note>
        <pitch><step>F</step><alter>1</alter><octave>5</octave></pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>A</step><octave>5</octave></pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;
