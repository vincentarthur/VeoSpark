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

# Check for the correct number of arguments.
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <DATASET_ID> <TABLE_ID>"
    exit 1
fi

DATASET_ID=$1
TABLE_ID=$2
SCHEMA_FILE="./schema.json"

# Check if the schema file exists.
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "Error: Schema file not found at $SCHEMA_FILE"
    exit 1
fi

echo "Creating BigQuery dataset '$DATASET_ID' if it doesn't exist..."
bq --location=US mk --dataset --description "Dataset for VeoSpark history" "$DATASET_ID" 2>/dev/null || echo "Dataset '$DATASET_ID' already exists."

echo "Creating BigQuery table '$TABLE_ID' in dataset '$DATASET_ID'..."
bq mk --table --description "VeoSpark generation history" "$DATASET_ID.$TABLE_ID" "$SCHEMA_FILE" 2>/dev/null || echo "Table '$DATASET_ID.$TABLE_ID' already exists."

echo "BigQuery setup completed successfully."
