import json
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

from feature_spec import FEATURE_NAMES, build_feature_matrix_from_pig_aggregated

# ==========================================
# 1. DATA PREPARATION
# ==========================================

class PianoFingeringDataset(Dataset):
    def __init__(self, csv_file, seq_length=16):
        self.seq_length = seq_length
        print("Loading and preprocessing dataset...")
        df = pd.read_csv(csv_file)

        # Subtract 1 so fingers 1-5 become classes 0-4 (PyTorch requires 0-indexed classes)
        self.labels = df['finger'].values - 1

        # Canonical feature vector shared with fingeringModelFeatures.ts - see
        # feature_spec.py and public/fingering_model_features.json.
        self.features = build_feature_matrix_from_pig_aggregated(df)
        self.input_size = self.features.shape[1]
        self.feature_names = list(FEATURE_NAMES)

        print(f"Preprocessing complete! Model will accept {self.input_size} input features.")

    def __len__(self):
        return len(self.features) - self.seq_length

    def __getitem__(self, idx):
        x = self.features[idx : idx + self.seq_length]
        y = self.labels[idx : idx + self.seq_length]
        return torch.tensor(x, dtype=torch.float32), torch.tensor(y, dtype=torch.long)

# ==========================================
# 2. THE NEURAL NETWORK ARCHITECTURE
# ==========================================

class FingeringLSTM(nn.Module):
    def __init__(self, input_features, hidden_size=64, num_layers=2, num_classes=5):
        super(FingeringLSTM, self).__init__()
        
        self.lstm = nn.LSTM(
            input_size=input_features, 
            hidden_size=hidden_size, 
            num_layers=num_layers, 
            batch_first=True, 
            bidirectional=True
        )
        self.fc = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        logits = self.fc(lstm_out)
        return logits

# ==========================================
# 3. THE TRAINING & EXPORT LOOP
# ==========================================

def train_model():
    # 1. Load Data
    dataset = PianoFingeringDataset('pig_aggregated.csv', seq_length=16)
    
    # 2. Split Data
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(dataset, [train_size, val_size])
    
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    
    # 3. Initialize Model
    model = FingeringLSTM(input_features=dataset.input_size)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    
    epochs = 15
    
    # 4. Train
    print("Starting training...")
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        correct_predictions = 0
        total_predictions = 0
        
        for batch_features, batch_labels in train_loader:
            optimizer.zero_grad()
            
            outputs = model(batch_features)
            
            # Reshape for loss calculation
            outputs_flat = outputs.view(-1, 5)
            labels_flat = batch_labels.view(-1)
            
            loss = criterion(outputs_flat, labels_flat)
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            
            # Calculate accuracy for monitoring
            _, predicted = torch.max(outputs_flat, 1)
            correct_predictions += (predicted == labels_flat).sum().item()
            total_predictions += labels_flat.size(0)
            
        accuracy = (correct_predictions / total_predictions) * 100
        print(f"Epoch {epoch+1}/{epochs} | Loss: {total_loss/len(train_loader):.4f} | Accuracy: {accuracy:.2f}%")

    print("\nTraining complete! Proceeding to export.")

    # ==========================================
    # 5. EXPORT TO ONNX
    # ==========================================
    print("Exporting model to ONNX format...")
    model.eval()

    # Create a dummy input tensor that matches the shape of our sequences.
    # Shape: [batch_size=1, sequence_length=16, num_features]
    dummy_input = torch.randn(1, 16, dataset.input_size)

    # dynamo=False uses the legacy ONNX exporter (stable with dynamic_axes + LSTM).
    torch.onnx.export(
        model,
        dummy_input,
        "fingering_model.onnx",
        export_params=True,
        opset_version=18,
        do_constant_folding=True,
        input_names=['note_sequence'],
        output_names=['finger_logits'],
        dynamic_axes={
            'note_sequence': {0: 'batch_size', 1: 'sequence_length'},
            'finger_logits': {0: 'batch_size', 1: 'sequence_length'},
        },
        dynamo=False,
    )
    
    print("Export complete! You can now move 'fingering_model.onnx' to your Vite public/ folder.")

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
        "input_size": dataset.input_size,
        "midi_normalization": "(midi - 60) / 24",
        "prev_interval_formula": "current.midi - previous.midi in the flat per-hand note sequence, 0 if no previous note",
        "next_interval_formula": "next.midi - current.midi in the flat per-hand note sequence, 0 if no next note",
        "is_chord_formula": "count of notes sharing this note's stepIndex within the hand's timeline > 1",
        "prev_finger_formula": "authoredFinger of the previous note in the flat per-hand sequence, or 0 if none/unauthored",
        "hand_encoding": "0 = L, 1 = R",
        "feature_names": dataset.feature_names,
    }
    with open("../playright/public/fingering_model_features.json", "w", encoding="utf-8") as meta_file:
        json.dump(feature_meta, meta_file, indent=2)
    print("Wrote playright/public/fingering_model_features.json")

if __name__ == "__main__":
    train_model()