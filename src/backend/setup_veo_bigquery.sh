#!/bin/bash
# This script creates the necessary BigQuery dataset and table for the VeoSpark application.
#
# Usage:
# 1. Authenticate with gcloud: `gcloud auth application-default login`
# 2. Set your project: `gcloud config set project YOUR_PROJECT_ID`
# 3. Run the script from the `src/backend` directory:
#    ./setup_bigquery.sh <DATASET_ID> <TABLE_ID>
#
# Example:
#    ./setup_bigquery.sh marketing_materials_analysis veo_history

# Exit immediately if a command exits with a non-zero status.
set -e

DATASET_ID=$(grep ANALYSIS_DATASET app-config.yaml | awk '{print $2}')
TABLE_ID=$(grep HISTORY_TABLE app-config.yaml | awk '{print $2}')
LOCATION=$(grep 'BIGQUERY_LOCATION:' app-config.yaml | awk '{print $2}')
SCHEMA_FILE="./schema_veo_history.json"

# Check if the schema file exists.
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "Error: Schema file not found at $SCHEMA_FILE"
    exit 1
fi

echo "Creating BigQuery dataset '$DATASET_ID' if it doesn't exist..."
bq --location=$LOCATION mk --dataset --description "Dataset for VeoSpark history" "$DATASET_ID" 2>/dev/null || echo "Dataset '$DATASET_ID' already exists."

echo "Creating BigQuery table '$TABLE_ID' in dataset '$DATASET_ID'..."
bq mk --table --description "VeoSpark generation history" "$DATASET_ID.$TABLE_ID" "$SCHEMA_FILE" 2>/dev/null || echo "Table '$DATASET_ID.$TABLE_ID' already exists."

echo "Table $TABLE_ID created successfully in dataset $DATASET_ID."
