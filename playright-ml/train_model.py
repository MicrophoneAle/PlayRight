"""
Trains the per-note fingering EMISSION model on pig_aggregated.csv
(PIG dataset, Nakamura et al. 2020, academic use only).

Architecture decision: this is NOT a sequence model. The model is a pointwise
classifier P(finger | canonical 24-dim note features); at inference PlayRight
converts its logits to per-note negative log-likelihood emission costs
(getMLFingerCosts) that feed the existing Viterbi DP, which owns transitions
and hand constraints. The MLP applies to the last tensor dim, so the exported
ONNX keeps the exact interface aiFingeringInference.ts already speaks:
note_sequence [batch, seq, 24] -> finger_logits [batch, seq, 5].

Split: PIG standard - test = pieces 1-30 (the multi-annotator evaluation set,
4-6 annotators each), train = pieces 31-150. Whole pieces only; no piece
appears on both sides.
"""

import json

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from feature_spec import FEATURE_NAMES, FEATURE_COUNT, build_feature_matrix_from_pig_aggregated

TEST_PIECE_MAX_ID = 30

# Feature column layout constants (see feature_spec.py / the JSON contract).
PREV_FINGER_OFFSET = 17
PREV_FINGER_CLASSES = 6

# At inference PlayRight rarely has an authored previous finger, so prev_finger
# is usually the 0 sentinel. Randomly collapsing prev_finger to the sentinel
# during training teaches the model both conditions.
PREV_FINGER_DROPOUT_P = 0.3

SEED = 20260703


def zero_prev_finger(features: np.ndarray) -> np.ndarray:
    out = features.copy()
    out[:, PREV_FINGER_OFFSET : PREV_FINGER_OFFSET + PREV_FINGER_CLASSES] = 0
    out[:, PREV_FINGER_OFFSET] = 1
    return out


class PerNoteEmissionMLP(nn.Module):
    """Pointwise classifier: works on [batch, features] and [batch, seq, features]."""

    def __init__(self, input_features, hidden_size=128, num_classes=5):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_features, hidden_size),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, num_classes),
        )

    def forward(self, x):
        return self.net(x)


def load_data():
    print("Loading and preprocessing dataset...")
    df = pd.read_csv("pig_aggregated.csv")
    features = build_feature_matrix_from_pig_aggregated(df)
    labels = df["finger"].to_numpy() - 1  # fingers 1-5 -> classes 0-4
    is_test = (df["piece_id"] <= TEST_PIECE_MAX_ID).to_numpy()
    print(
        f"{len(df)} rows, {FEATURE_COUNT} features | "
        f"train rows {(~is_test).sum()} (pieces {TEST_PIECE_MAX_ID + 1}-150) | "
        f"test rows {is_test.sum()} (pieces 1-{TEST_PIECE_MAX_ID})"
    )
    return df, features, labels, is_test


def train(model, features, labels, epochs=20, batch_size=512):
    rng = np.random.default_rng(SEED)
    dataset = TensorDataset(
        torch.tensor(features, dtype=torch.float32),
        torch.tensor(labels, dtype=torch.long),
    )
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)

    for epoch in range(epochs):
        model.train()
        total_loss, correct, total = 0.0, 0, 0
        for batch_features, batch_labels in loader:
            # prev_finger sentinel augmentation (see PREV_FINGER_DROPOUT_P).
            drop = torch.tensor(
                rng.random(len(batch_features)) < PREV_FINGER_DROPOUT_P
            )
            if drop.any():
                block = slice(PREV_FINGER_OFFSET, PREV_FINGER_OFFSET + PREV_FINGER_CLASSES)
                batch_features[drop, block] = 0
                batch_features[drop, PREV_FINGER_OFFSET] = 1

            optimizer.zero_grad()
            logits = model(batch_features)
            loss = criterion(logits, batch_labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            correct += (logits.argmax(dim=1) == batch_labels).sum().item()
            total += len(batch_labels)
        print(
            f"Epoch {epoch + 1}/{epochs} | loss {total_loss / len(loader):.4f} "
            f"| train acc {100 * correct / total:.2f}%"
        )


@torch.no_grad()
def predict(model, features):
    model.eval()
    logits = model(torch.tensor(features, dtype=torch.float32))
    return logits.argmax(dim=1).numpy()


def evaluate(model, df, features, labels, is_test):
    test_df = df[is_test].reset_index(drop=True)
    test_features = features[is_test]
    test_labels = labels[is_test]

    print("\n=== Test metrics (pieces 1-%d, held out whole) ===" % TEST_PIECE_MAX_ID)

    preds = predict(model, test_features)
    preds_nf = predict(model, zero_prev_finger(test_features))

    for hand in ["R", "L"]:
        mask = (test_df["hand"] == hand).to_numpy()
        acc = 100 * (preds[mask] == test_labels[mask]).mean()
        acc_nf = 100 * (preds_nf[mask] == test_labels[mask]).mean()
        print(
            f"hand {hand}: per-note accuracy {acc:.2f}% "
            f"(with annotator prev_finger) | {acc_nf:.2f}% (prev_finger sentinel, inference condition)"
        )
    acc_all = 100 * (preds == test_labels).mean()
    acc_all_nf = 100 * (preds_nf == test_labels).mean()
    print(f"overall : {acc_all:.2f}% | {acc_all_nf:.2f}% (sentinel)")

    # Match-against-any-annotator: only piece-hand groups where every
    # annotator's midi sequence is identical (annotators sometimes assign
    # notes to different hands, so per-hand sequences do not always align by
    # seq_pos; the CSV has no onset column to realign on). Predictions use the
    # first annotator's feature rows with prev_finger at sentinel, so they are
    # annotator-independent.
    matched, compared, groups_used, groups_total = 0, 0, 0, 0
    for (_pid, hand), group in test_df.groupby(["piece_id", "hand"]):
        groups_total += 1
        annotators = {
            ann: sub.sort_values("seq_pos") for ann, sub in group.groupby("annotator")
        }
        midi_seqs = [sub["midi"].tolist() for sub in annotators.values()]
        if any(seq != midi_seqs[0] for seq in midi_seqs[1:]):
            continue
        groups_used += 1

        first = next(iter(annotators.values()))
        row_positions = test_df.index.get_indexer(first.index)
        group_preds = predict(model, zero_prev_finger(test_features[row_positions]))

        finger_sets = np.stack(
            [sub["finger"].to_numpy() - 1 for sub in annotators.values()], axis=1
        )
        matched += (group_preds[:, None] == finger_sets).any(axis=1).sum()
        compared += len(group_preds)

    print(
        f"match-against-any-annotator: {100 * matched / compared:.2f}% "
        f"({matched}/{compared} notes; {groups_used}/{groups_total} piece-hand groups aligned)"
    )

    print("\nConfusion matrix (rows = annotator finger, cols = predicted, teacher-forced):")
    matrix = np.zeros((5, 5), dtype=int)
    for actual, predicted in zip(test_labels, preds):
        matrix[actual][predicted] += 1
    header = "        " + "".join(f"pred {f + 1:<4}" for f in range(5))
    print(header)
    for finger in range(5):
        row = "".join(f"{matrix[finger][col]:<9}" for col in range(5))
        print(f"true {finger + 1}: {row}")


def export_onnx(model):
    print("\nExporting model to ONNX format...")
    model.eval()
    dummy_input = torch.randn(1, 16, FEATURE_COUNT)

    # Same export config that already loads in onnxruntime-web (see git history
    # of this file): legacy exporter, opset 18, dynamic batch/sequence axes.
    torch.onnx.export(
        model,
        dummy_input,
        "fingering_model.onnx",
        export_params=True,
        opset_version=18,
        do_constant_folding=True,
        input_names=["note_sequence"],
        output_names=["finger_logits"],
        dynamic_axes={
            "note_sequence": {0: "batch_size", 1: "sequence_length"},
            "finger_logits": {0: "batch_size", 1: "sequence_length"},
        },
        dynamo=False,
    )
    print("Wrote fingering_model.onnx (playright-ml/). Not copied to playright/public/ yet.")

    # Contract shared with playright/src/core/fingeringModelFeatures.ts - keep
    # this in sync with feature_spec.py; do not add data-fit scaler stats here,
    # normalization is a fixed formula so both sides derive it identically.
    feature_meta = {
        "_comment": (
            "Canonical feature contract shared by playright-ml/feature_spec.py "
            "(Python trainer) and playright/src/core/fingeringModelFeatures.ts "
            "(TS inference). Only quantities PlayRight can compute at inference "
            "from a parsed MusicXML NoteEvent sequence: midi, is_chord (same "
            "stepIndex as another note in the hand's timeline), prev_finger "
            "(authored finger of the previous note in sequence, or 0 sentinel), "
            "hand. pitch_class, is_black, prev_interval, next_interval are "
            "derived from midi by the formulas below, not read from any "
            "pre-aggregated column, so both implementations compute them "
            "identically from the same primitives. No velocity, no MFCC, no "
            "audio/similarity features - PlayRight has no audio signal at "
            "inference time."
        ),
        "input_size": FEATURE_COUNT,
        "midi_normalization": "(midi - 60) / 24",
        "prev_interval_formula": "current.midi - previous.midi in the flat per-hand note sequence, 0 if no previous note",
        "next_interval_formula": "next.midi - current.midi in the flat per-hand note sequence, 0 if no next note",
        "is_chord_formula": "count of notes sharing this note's stepIndex within the hand's timeline > 1",
        "prev_finger_formula": "authoredFinger of the previous note in the flat per-hand sequence, or 0 if none/unauthored",
        "hand_encoding": "0 = L, 1 = R",
        "feature_names": list(FEATURE_NAMES),
    }
    with open("../playright/public/fingering_model_features.json", "w", encoding="utf-8") as meta_file:
        json.dump(feature_meta, meta_file, indent=2)
    print("Wrote playright/public/fingering_model_features.json")


def train_model():
    torch.manual_seed(SEED)
    np.random.seed(SEED)

    df, features, labels, is_test = load_data()

    model = PerNoteEmissionMLP(input_features=FEATURE_COUNT)
    train(model, features[~is_test], labels[~is_test])

    evaluate(model, df, features, labels, is_test)
    export_onnx(model)


if __name__ == "__main__":
    train_model()
