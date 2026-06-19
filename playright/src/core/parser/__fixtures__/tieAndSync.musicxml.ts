/** Score with tied notes, consecutive repeated pitches, and a cross-staff unison. */
export const TIE_AND_SYNC_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <staves>2</staves>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
        <tie type="start"/>
        <notations>
          <tied type="start"/>
        </notations>
      </note>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
        <tie type="stop"/>
        <notations>
          <tied type="stop"/>
        </notations>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>240</duration>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>4</octave>
        </pitch>
        <duration>240</duration>
        <staff>1</staff>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>G</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <staff>1</staff>
      </note>
      <backup>
        <duration>480</duration>
      </backup>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>480</duration>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>480</duration>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;
