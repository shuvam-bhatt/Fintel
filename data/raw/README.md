# Fintel — Dataset Directory

## Generating Datasets

Since the IEEE-CIS Fraud Detection dataset is unavailable on Kaggle, we generate
a synthetic version that mimics its structure.

### Step 1: Generate synthetic IEEE-CIS data
```bash
python scripts/generate_synthetic_ieee.py --count 50000
```
This creates `train_transaction.csv` and `train_identity.csv` in this directory.

### Step 2 (optional): Download PaySim
Download from: https://www.kaggle.com/datasets/ealaxi/paysim1
Place the CSV here and rename to `paysim.csv`, or the loader will auto-detect
the long filename (PS_20174392719_*.csv).

### Step 3: Load into database
```bash
# Start the database first
docker compose up db -d

# Load datasets
python scripts/load_ieee_cis.py
python scripts/load_paysim.py          # if you downloaded PaySim
python scripts/mule_scenarios.py       # hand-crafted attack scenarios
python scripts/generate_kyc.py         # synthetic KYC profiles
python scripts/ground_truth.py         # evaluation labels
```
