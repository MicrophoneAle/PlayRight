import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler

# ==========================================
# 1. DATA PREPARATION
# ==========================================

class PianoFingeringDataset(Dataset):
    def __init__(self, csv_file, seq_length=16):
        self.seq_length = seq_length
        print("Loading and preprocessing dataset...")
        df = pd.read_csv(csv_file)
        
        # 1. Separate Target Label
        # Subtract 1 so fingers 1-5 become classes 0-4 (PyTorch requires 0-indexed classes)
        self.labels = df['Finger_Label'].values - 1
        df = df.drop(columns=['Finger_Label'])
        
        # 2. Identify Column Types
        categorical_cols = [
            'Pitch_Class', 'Hand_Assignment', 'Note_Type', 'Interval_Type', 
            'Note_Duration', 'Position_Shift', 'Estimated_Hand_Strain', 'Transition_Cost_Level'
        ]
        
        numeric_cols = [
            'Octave', 'Velocity_Level', 'Previous_Finger', 'Hand_Span_Requirement', 
            'Sequence_Similarity_Score'
        ] + [f'MFCC_{i}' for i in range(1, 14)]
        
        # 3. Scale Numeric Features
        scaler = StandardScaler()
        df[numeric_cols] = scaler.fit_transform(df[numeric_cols])
        
        # 4. One-Hot Encode Categorical Features
        # This turns categorical text into binary columns (1s and 0s)
        df = pd.get_dummies(df, columns=categorical_cols, dtype=float)
        
        # Save the processed features as a numpy array
        self.features = df.values
        self.input_size = self.features.shape[1] 
        
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
    # Ensure this matches your CSV filename exactly
    dataset = PianoFingeringDataset('automated_piano_fingering_dataset.csv', seq_length=16) 
    
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

if __name__ == "__main__":
    train_model()