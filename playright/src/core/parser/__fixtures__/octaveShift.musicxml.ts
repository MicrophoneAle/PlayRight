/**
 * Octave-shift fixture. Per the MusicXML spec, <pitch> is always the SOUNDING
 * pitch; <octave-shift> is a notation-layer instruction (draw the notehead an
 * octave lower/higher with an 8va/8vb bracket). The parser must therefore use
 * pitch data as-is under a bracket — no additional MIDI shift — and direction
 * elements must never advance the timeline.
 *
 * Staff 1 carries an 8va span (type="down", displayed lower than sounding)
 * containing a tied pair; staff 2 carries an 8vb span (type="up").
 */
export const OCTAVE_SHIFT_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>2</staves>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <direction placement="above">
        <direction-type>
          <octave-shift type="down" size="8" number="1"/>
        </direction-type>
        <staff>1</staff>
      </direction>
      <note>
        <pitch><step>D</step><octave>6</octave></pitch>
        <duration>480</duration>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>6</octave></pitch>
        <duration>480</duration>
        <tie type="stop"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><tied type="stop"/></notations>
      </note>
      <direction placement="above">
        <direction-type>
          <octave-shift type="stop" size="8" number="1"/>
        </direction-type>
        <staff>1</staff>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>480</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>1920</duration>
      </backup>
      <direction placement="below">
        <direction-type>
          <octave-shift type="up" size="8" number="2"/>
        </direction-type>
        <staff>2</staff>
      </direction>
      <note>
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>960</duration>
        <voice>5</voice>
        <type>half</type>
        <staff>2</staff>
      </note>
      <direction placement="below">
        <direction-type>
          <octave-shift type="stop" size="8" number="2"/>
        </direction-type>
        <staff>2</staff>
      </direction>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>960</duration>
        <voice>5</voice>
        <type>half</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;
