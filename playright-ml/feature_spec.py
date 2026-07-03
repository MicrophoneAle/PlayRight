"""
Canonical feature contract shared with playright/src/core/fingeringModelFeatures.ts.
See playright/public/fingering_model_features.json for the schema this must match.

Only quantities PlayRight can compute at inference from a parsed MusicXML
NoteEvent sequence: midi, is_chord, prev_finger, hand. pitch_class, is_black,
prev_interval, next_interval are DERIVED from midi by the formulas below (not
read from any pre-aggregated column), so this module and the TS side compute
them identically from the same primitives. No velocity, no MFCC, no
audio/similarity features.
"""

import numpy as np
import pandas as pd

MIDI_NORM_CENTER = 60
MIDI_NORM_SCALE = 24

BLACK_KEY_PITCH_CLASSES = {1, 3, 6, 8, 10}

# Must match public/fingering_model_features.json feature_names, in order.
FEATURE_NAMES = (
    ["midi_norm"]
    + [f"pitch_class_{pc}" for pc in
       ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]]
    + ["is_black", "prev_interval", "next_interval", "is_chord"]
    + [f"prev_finger_{i}" for i in range(6)]
    + ["hand"]
)

FEATURE_COUNT = len(FEATURE_NAMES)


def build_feature_matrix(
    midi: pd.Series,
    is_chord: pd.Series,
    prev_finger: pd.Series,
    hand: pd.Series,
    prev_midi: pd.Series,
    next_midi: pd.Series,
) -> np.ndarray:
    """Builds the canonical (N, FEATURE_COUNT) feature matrix from primitives.

    midi, is_chord, prev_finger, hand are given (structural/annotation facts,
    not derivable from pitch alone). prev_midi/next_midi are the immediate
    neighbor's midi within the same (piece, annotator, hand) sequence, or NaN
    at sequence boundaries - prev_interval/next_interval are derived from
    these the same way fingeringModelFeatures.ts derives them from adjacent
    NoteEvents.
    """
    n = len(midi)
    features = np.zeros((n, FEATURE_COUNT), dtype=np.float32)

    midi_arr = midi.to_numpy()
    pitch_class = midi_arr % 12

    features[:, 0] = (midi_arr - MIDI_NORM_CENTER) / MIDI_NORM_SCALE

    for i, pc in enumerate(pitch_class):
        features[i, 1 + pc] = 1

    features[:, 13] = np.isin(pitch_class, list(BLACK_KEY_PITCH_CLASSES)).astype(
        np.float32
    )

    prev_interval = (midi_arr - prev_midi.to_numpy()).astype(np.float64)
    prev_interval = np.nan_to_num(prev_interval, nan=0.0)
    features[:, 14] = prev_interval

    next_interval = (next_midi.to_numpy() - midi_arr).astype(np.float64)
    next_interval = np.nan_to_num(next_interval, nan=0.0)
    features[:, 15] = next_interval

    features[:, 16] = is_chord.to_numpy().astype(np.float32)

    prev_finger_arr = prev_finger.to_numpy()
    for i, pf in enumerate(prev_finger_arr):
        features[i, 17 + int(pf)] = 1

    features[:, 23] = (hand.to_numpy() == "R").astype(np.float32)

    return features


def build_feature_matrix_from_pig_aggregated(df: pd.DataFrame) -> np.ndarray:
    """Builds features from a pig_aggregated.csv-shaped dataframe.

    prev_midi/next_midi are recomputed by shifting midi within each
    (piece_id, annotator, hand) sequence rather than trusting the CSV's own
    prev_interval/next_interval columns, so the trainer exercises the exact
    same derivation formulas as fingeringModelFeatures.ts.
    """
    grouped = df.groupby(["piece_id", "annotator", "hand"], sort=False)
    prev_midi = grouped["midi"].shift(1)
    next_midi = grouped["midi"].shift(-1)

    return build_feature_matrix(
        midi=df["midi"],
        is_chord=df["is_chord"],
        prev_finger=df["prev_finger"],
        hand=df["hand"],
        prev_midi=prev_midi,
        next_midi=next_midi,
    )
