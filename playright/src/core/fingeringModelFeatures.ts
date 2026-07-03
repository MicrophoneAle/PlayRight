import type { Hand } from '../types/index.ts';
import type { NoteEvent } from './fingeringPredictor.ts';

/**
 * Canonical feature vector shared with playright-ml/feature_spec.py. See
 * public/fingering_model_features.json for the schema contract and formulas.
 * Only quantities PlayRight can compute at inference from a parsed MusicXML
 * NoteEvent sequence - no velocity, no MFCC, no audio/similarity features.
 */
export const FINGERING_FEATURE_COUNT = 24;

// Pitch class order for the one-hot block: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
// (index = midi % 12), matching public/fingering_model_features.json.
const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

const MIDI_NORM_CENTER = 60;
const MIDI_NORM_SCALE = 24;

// Feature layout (must match public/fingering_model_features.json feature_names):
// [0] midi_norm
// [1..12] pitch_class one-hot (C, C#, D, D#, E, F, F#, G, G#, A, A#, B)
// [13] is_black
// [14] prev_interval
// [15] next_interval
// [16] is_chord
// [17..22] prev_finger one-hot (0=none, 1-5)
// [23] hand (0=L, 1=R)
const PITCH_CLASS_OFFSET = 1;
const IS_BLACK_INDEX = 13;
const PREV_INTERVAL_INDEX = 14;
const NEXT_INTERVAL_INDEX = 15;
const IS_CHORD_INDEX = 16;
const PREV_FINGER_OFFSET = 17;
const HAND_INDEX = 23;

export interface MLFeatureContext {
  hand: Hand;
  index: number;
  phraseNotes: NoteEvent[];
}

export function buildModelFeatureRow(context: MLFeatureContext): Float32Array {
  const row = new Float32Array(FINGERING_FEATURE_COUNT);
  const { hand, index, phraseNotes } = context;
  const note = phraseNotes[index];
  const prev = index > 0 ? phraseNotes[index - 1] : null;
  const next = index < phraseNotes.length - 1 ? phraseNotes[index + 1] : null;

  const pitchClass = note.midi % 12;
  const chordSize = phraseNotes.filter(
    (entry) => entry.stepIndex === note.stepIndex,
  ).length;
  const prevFinger: number = prev?.authoredFinger ?? 0;

  row[0] = (note.midi - MIDI_NORM_CENTER) / MIDI_NORM_SCALE;
  row[PITCH_CLASS_OFFSET + pitchClass] = 1;
  row[IS_BLACK_INDEX] = BLACK_KEY_PITCH_CLASSES.has(pitchClass) ? 1 : 0;
  row[PREV_INTERVAL_INDEX] = prev ? note.midi - prev.midi : 0;
  row[NEXT_INTERVAL_INDEX] = next ? next.midi - note.midi : 0;
  row[IS_CHORD_INDEX] = chordSize > 1 ? 1 : 0;
  row[PREV_FINGER_OFFSET + prevFinger] = 1;
  row[HAND_INDEX] = hand === 'R' ? 1 : 0;

  return row;
}
