import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split

# ==========================================
# 1. DATA PREPARATION (The Dataset Class)
# ==========================================

class PianoFingeringDataset(Dataset):
    def __init__(self, csv_file, seq_length=16):
        """
        seq_length: How many notes the model looks at simultaneously (a "phrase" window).
        """
        self.seq_length = seq_length
        self.data = pd.read_csv(csv_file)
        
        # NOTE: You will need to change these column names to match the exact headers in your Kaggle CSV
        pitch_col = 'pitch'   # The MIDI number
        finger_col = 'finger' # The finger used (1-5)
        
        # 1. Extract Features
        # We want relative distances, not absolute MIDI numbers, so the model learns patterns, not specific keys.
        self.data['pitch_delta'] = self.data[pitch_col].diff().fillna(0)
        self.data['is_black_key'] = self.data[pitch_col].apply(lambda x: 1 if x % 12 in [1, 3, 6, 8, 10] else 0)
        
        # 2. Extract Labels (Subtract 1 so fingers 1-5 become classes 0-4 for PyTorch)
        self.data['label'] = self.data[finger_col] - 1
        
        # Convert to numpy arrays for fast slicing
        self.features = self.data[['pitch_delta', 'is_black_key']].values
        self.labels = self.data['label'].values

    def __len__(self):
        # We return how many valid sequences of `seq_length` we can make
        return len(self.data) - self.seq_length

    def __getitem__(self, idx):
        # Grab a "window" of notes
        x = self.features[idx : idx + self.seq_length]
        y = self.labels[idx : idx + self.seq_length]
        
        # Convert to PyTorch tensors (Float for inputs, Long for classification targets)
        return torch.tensor(x, dtype=torch.float32), torch.tensor(y, dtype=torch.long)

# ==========================================
# 2. THE NEURAL NETWORK ARCHITECTURE
# ==========================================

class FingeringLSTM(nn.Module):
    def __init__(self, input_features=2, hidden_size=64, num_layers=2, num_classes=5):
        super(FingeringLSTM, self).__init__()
        
        # The Bi-directional LSTM
        self.lstm = nn.LSTM(
            input_size=input_features, 
            hidden_size=hidden_size, 
            num_layers=num_layers, 
            batch_first=True, 
            bidirectional=True
        )
        
        # The output layer (maps the LSTM's hidden state to the 5 finger probabilities)
        # Multiply hidden_size by 2 because the LSTM is bi-directional
        self.fc = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x):
        # Pass data through LSTM
        lstm_out, _ = self.lstm(x)
        # Pass output through the linear layer to get the 5 class logits
        logits = self.fc(lstm_out)
        return logits

# ==========================================
# 3. THE TRAINING LOOP
# ==========================================

def train_model():
    # 1. Load Data
    print("Loading dataset...")
    # UPDATE THIS PATH to point to your unzipped Kaggle CSV
    dataset = PianoFingeringDataset('automated_piano_fingering_dataset.csv', seq_length=16) 
    
    # Split into training and validation sets
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(dataset, [train_size, val_size])
    
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    
    # 2. Initialize Model, Loss, and Optimizer
    model = FingeringLSTM()
    criterion = nn.CrossEntropyLoss() # Standard loss for classification
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    
    epochs = 10
    
    # 3. Train
    print("Starting training...")
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        
        for batch_features, batch_labels in train_loader:
            optimizer.zero_grad()
            
            # Forward pass
            outputs = model(batch_features)
            
            # Reshape for CrossEntropyLoss (expects [batch_size * seq_length, num_classes])
            outputs = outputs.view(-1, 5)
            batch_labels = batch_labels.view(-1)
            
            # Calculate error and backpropagate
            loss = criterion(outputs, batch_labels)
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            
        print(f"Epoch {epoch+1}/{epochs} | Loss: {total_loss/len(train_loader):.4f}")
        
    print("Training complete! Model is ready for export.")
    
    # (Export logic will go here next)

if __name__ == "__main__":
    train_model()