#!/bin/bash
# exit when any command fails
set -e

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Load environment variables from app-config.yaml
PROJECT_ID=$(grep "PROJECT_ID" "$SCRIPT_DIR/../configs/app-config.yaml" | awk '{print $2}')
ANALYSIS_DATASET=$(grep "ANALYSIS_DATASET" "$SCRIPT_DIR/../configs/app-config.yaml" | awk '{print $2}')
IMAGE_ENRICHMENT_HISTORY_TABLE=$(grep "IMAGE_ENRICHMENT_HISTORY_TABLE" "$SCRIPT_DIR/../configs/app-config.yaml" | awk '{print $2}')
SCHEMA_FILE="$SCRIPT_DIR/../schemas/image_enrichment_history.json"

# Check if the dataset exists, if not create it
if ! bq show --dataset "$PROJECT_ID:$ANALYSIS_DATASET" &>/dev/null; then
  echo "Dataset $ANALYSIS_DATASET does not exist. Creating..."
  bq --location=US mk --dataset "$PROJECT_ID:$ANALYSIS_DATASET"
else
  echo "Dataset $ANALYSIS_DATASET already exists."
fi

# Check if the table exists, if not create it
if ! bq show --table "$PROJECT_ID:$ANALYSIS_DATASET.$IMAGE_ENRICHMENT_HISTORY_TABLE" &>/dev/null; then
  echo "Table $IMAGE_ENRICHMENT_HISTORY_TABLE does not exist. Creating..."
  bq mk --table "$PROJECT_ID:$ANALYSIS_DATASET.$IMAGE_ENRICHMENT_HISTORY_TABLE" "$SCHEMA_FILE"
else
  echo "Table $IMAGE_ENRICHMENT_HISTORY_TABLE already exists."
fi
