"""
Generates the cross-language parity fixture consumed by
playright/src/core/fingeringModelFeatureParity.test.ts.

Computes the canonical feature vector for two fixed, hardcoded note contexts
(a 4-note R-hand phrase with a trailing chord, and a 1-note L-hand phrase)
using feature_spec.py, and writes them to feature_parity_fixture.json. The TS
test builds the identical NoteEvent contexts via buildModelFeatureRow and
asserts every row matches exactly, catching drift between the Python and TS
feature definitions before training.

Re-run this script and commit the updated fixture only when the canonical
feature definition intentionally changes (update fingeringModelFeatures.ts
and feature_spec.py together, then regenerate).
"""

import json

import numpy as np
import pandas as pd

from feature_spec import build_feature_matrix

# R-hand phrase: C4 -> E4 -> [G4, C5] chord (stepIndex 0, 1, 2, 2).
# Mirrors the flat per-hand NoteEvent sequence PlayRight's parser produces:
# prev/next are the immediate sequence neighbors, not filtered by chord
# membership - matches fingeringModelFeatures.ts's phraseNotes[index-1/+1].
r_hand_midi = pd.Series([60, 64, 67, 72])
r_hand_is_chord = pd.Series([0, 0, 1, 1])
r_hand_prev_finger = pd.Series([0, 1, 3, 3])
r_hand_hand = pd.Series(["R", "R", "R", "R"])
r_hand_prev_midi = pd.Series([np.nan, 60, 64, 67])
r_hand_next_midi = pd.Series([64, 67, 72, np.nan])

r_hand_features = build_feature_matrix(
    midi=r_hand_midi,
    is_chord=r_hand_is_chord,
    prev_finger=r_hand_prev_finger,
    hand=r_hand_hand,
    prev_midi=r_hand_prev_midi,
    next_midi=r_hand_next_midi,
)

# L-hand phrase: single note, no previous/next context.
l_hand_midi = pd.Series([48])
l_hand_is_chord = pd.Series([0])
l_hand_prev_finger = pd.Series([0])
l_hand_hand = pd.Series(["L"])
l_hand_prev_midi = pd.Series([np.nan])
l_hand_next_midi = pd.Series([np.nan])

l_hand_features = build_feature_matrix(
    midi=l_hand_midi,
    is_chord=l_hand_is_chord,
    prev_finger=l_hand_prev_finger,
    hand=l_hand_hand,
    prev_midi=l_hand_prev_midi,
    next_midi=l_hand_next_midi,
)

fixture = {
    "r_hand_phrase": {
        "midi": r_hand_midi.tolist(),
        "authored_finger_for_prev_finger_check": r_hand_prev_finger.tolist(),
        "vectors": r_hand_features.tolist(),
    },
    "l_hand_phrase": {
        "midi": l_hand_midi.tolist(),
        "vectors": l_hand_features.tolist(),
    },
}

with open("feature_parity_fixture.json", "w", encoding="utf-8") as f:
    json.dump(fixture, f, indent=2)

print("Wrote feature_parity_fixture.json")
