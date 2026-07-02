import type { Finger, Hand } from '../types/index.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

/** Must match train_model.py after one-hot encoding (52 features). */
export const FINGERING_FEATURE_COUNT = 52;

const SCALER_MEAN = [
  4.02775, 78.1235, 3.05425, 5.97, 0.59704025,
  -0.012784125, -0.003272975, 0.00092935, 0.01875125, 0.001073575,
  -0.01704325, -0.014742525, -0.01907745, -0.022450125, -0.003079225,
  0.015168175, -0.002733725, 0.009950125,
] as const;

const SCALER_SCALE = [
  2.008974847403521, 28.13663533100573, 1.412730313081729, 3.1221947408834065,
  0.23029340987083738, 1.0188089331717132, 0.991337779357848, 1.0214969798993914,
  0.9953501679551963, 0.9914118439600262, 0.9786191030960092, 1.00856561667505,
  0.9959721041557827, 0.9928521119179756, 0.9977431598141374, 0.9880092715125043,
  1.0247597568260203, 0.9900450765747912,
] as const;

const FEATURE_INDEX: Record<string, number> = {
  Octave: 0,
  Velocity_Level: 1,
  Previous_Finger: 2,
  Hand_Span_Requirement: 3,
  Sequence_Similarity_Score: 4,
  MFCC_1: 5,
  MFCC_2: 6,
  MFCC_3: 7,
  MFCC_4: 8,
  MFCC_5: 9,
  MFCC_6: 10,
  MFCC_7: 11,
  MFCC_8: 12,
  MFCC_9: 13,
  MFCC_10: 14,
  MFCC_11: 15,
  MFCC_12: 16,
  MFCC_13: 17,
  'Pitch_Class_A': 18,
  'Pitch_Class_A#': 19,
  'Pitch_Class_B': 20,
  'Pitch_Class_C': 21,
  'Pitch_Class_C#': 22,
  'Pitch_Class_D': 23,
  'Pitch_Class_D#': 24,
  'Pitch_Class_E': 25,
  'Pitch_Class_F': 26,
  'Pitch_Class_F#': 27,
  'Pitch_Class_G': 28,
  'Pitch_Class_G#': 29,
  Hand_Assignment_Left: 30,
  Hand_Assignment_Right: 31,
  Note_Type_Arpeggio: 32,
  Note_Type_Chord: 33,
  Note_Type_Repeated: 34,
  Note_Type_Single: 35,
  Interval_Type_Leap: 36,
  Interval_Type_Skip: 37,
  Interval_Type_Step: 38,
  Note_Duration_Eighth: 39,
  Note_Duration_Half: 40,
  Note_Duration_Quarter: 41,
  Note_Duration_Sixteenth: 42,
  Note_Duration_Whole: 43,
  Position_Shift_No: 44,
  Position_Shift_Yes: 45,
  Estimated_Hand_Strain_High: 46,
  Estimated_Hand_Strain_Low: 47,
  Estimated_Hand_Strain_Medium: 48,
  Transition_Cost_Level_High: 49,
  Transition_Cost_Level_Low: 50,
  Transition_Cost_Level_Medium: 51,
};

const PITCH_CLASSES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

function scaleNumeric(index: number, value: number): number {
  return (value - SCALER_MEAN[index]) / SCALER_SCALE[index];
}

function setOneHot(row: Float32Array, key: string): void {
  const index = FEATURE_INDEX[key];
  if (index !== undefined) {
    row[index] = 1;
  }
}

function midiToOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

function midiToPitchClass(midi: number): (typeof PITCH_CLASSES)[number] {
  return PITCH_CLASSES[midi % 12];
}

function classifyInterval(semitones: number): 'Step' | 'Skip' | 'Leap' {
  const delta = Math.abs(semitones);
  if (delta <= 2) {
    return 'Step';
  }
  if (delta <= 4) {
    return 'Skip';
  }
  return 'Leap';
}

function classifyNoteDuration(
  durationDivisions: number | undefined,
  divisionsPerQuarter: number | undefined,
): 'Whole' | 'Half' | 'Quarter' | 'Eighth' | 'Sixteenth' {
  if (
    durationDivisions === undefined ||
    divisionsPerQuarter === undefined ||
    divisionsPerQuarter <= 0
  ) {
    return 'Quarter';
  }

  const ratio = durationDivisions / divisionsPerQuarter;
  if (ratio >= 3.5) {
    return 'Whole';
  }
  if (ratio >= 1.75) {
    return 'Half';
  }
  if (ratio >= 0.875) {
    return 'Quarter';
  }
  if (ratio >= 0.4375) {
    return 'Eighth';
  }
  return 'Sixteenth';
}

function classifyNoteType(
  note: NoteEvent,
  prevMidi: number | null,
  chordSize: number,
): 'Single' | 'Chord' | 'Repeated' | 'Arpeggio' {
  if (chordSize > 1) {
    return 'Chord';
  }
  if (prevMidi !== null && note.midi === prevMidi) {
    return 'Repeated';
  }
  return 'Single';
}

function positionShift(
  octave: number,
  prevOctave: number | null,
): 'Yes' | 'No' {
  if (prevOctave === null) {
    return 'No';
  }
  return Math.abs(octave - prevOctave) >= 1 ? 'Yes' : 'No';
}

function estimatedHandStrain(span: number): 'Low' | 'Medium' | 'High' {
  if (span <= 4) {
    return 'Low';
  }
  if (span <= 7) {
    return 'Medium';
  }
  return 'High';
}

function transitionCostLevel(
  interval: 'Step' | 'Skip' | 'Leap',
): 'Low' | 'Medium' | 'High' {
  if (interval === 'Step') {
    return 'Low';
  }
  if (interval === 'Skip') {
    return 'Medium';
  }
  return 'High';
}

export interface MLFeatureContext {
  hand: Hand;
  index: number;
  phraseNotes: NoteEvent[];
  divisionsPerQuarter?: number;
}

export function buildModelFeatureRow(context: MLFeatureContext): Float32Array {
  const row = new Float32Array(FINGERING_FEATURE_COUNT);
  const { hand, index, phraseNotes, divisionsPerQuarter } = context;
  const note = phraseNotes[index];
  const prev = index > 0 ? phraseNotes[index - 1] : null;
  const phraseSpan =
    phraseNotes.length > 0
      ? Math.max(...phraseNotes.map((entry) => entry.midi)) -
        Math.min(...phraseNotes.map((entry) => entry.midi))
      : 0;

  const pitchClass = midiToPitchClass(note.midi);
  const octave = midiToOctave(note.midi);
  const prevOctave = prev ? midiToOctave(prev.midi) : null;
  const semitoneDelta = prev ? note.midi - prev.midi : 0;
  const intervalType = classifyInterval(semitoneDelta);
  const chordSize = phraseNotes.filter(
    (entry) => entry.stepIndex === note.stepIndex,
  ).length;
  const noteType = classifyNoteType(note, prev?.midi ?? null, chordSize);
  const duration = classifyNoteDuration(
    note.durationDivisions,
    divisionsPerQuarter,
  );
  const prevFinger: Finger = prev?.authoredFinger ?? 3;

  row[FEATURE_INDEX.Octave] = scaleNumeric(0, octave);
  row[FEATURE_INDEX.Velocity_Level] = scaleNumeric(1, 78);
  row[FEATURE_INDEX.Previous_Finger] = scaleNumeric(2, prevFinger);
  row[FEATURE_INDEX.Hand_Span_Requirement] = scaleNumeric(3, phraseSpan);
  row[FEATURE_INDEX.Sequence_Similarity_Score] = scaleNumeric(4, 0.597);

  setOneHot(row, `Pitch_Class_${pitchClass}`);
  setOneHot(row, `Hand_Assignment_${hand === 'L' ? 'Left' : 'Right'}`);
  setOneHot(row, `Note_Type_${noteType}`);
  setOneHot(row, `Interval_Type_${intervalType}`);
  setOneHot(row, `Note_Duration_${duration}`);
  setOneHot(row, `Position_Shift_${positionShift(octave, prevOctave)}`);
  setOneHot(row, `Estimated_Hand_Strain_${estimatedHandStrain(phraseSpan)}`);
  setOneHot(row, `Transition_Cost_Level_${transitionCostLevel(intervalType)}`);

  return row;
}
