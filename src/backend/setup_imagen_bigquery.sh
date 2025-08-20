#!/bin/bash
# This script creates the BigQuery table for Imagen history logging.

# Exit on error
set -e

# Load environment variables from app-config.yaml
PROJECT_ID=$(grep 'PROJECT_ID:' app-config.yaml | sed 's/PROJECT_ID: //')
DATASET_ID=$(grep 'ANALYSIS_DATASET:' app-config.yaml | sed 's/ANALYSIS_DATASET: //')
TABLE_ID=$(grep 'IMAGEN_HISTORY_TABLE:' app-config.yaml | sed 's/ANALYSIS_DATASET: //')

LOCATION=$(grep 'BIGQUERY_LOCATION:' app-config.yaml | sed 's/BIGQUERY_LOCATION: //')

echo "Using Project ID: $PROJECT_ID"
echo "Using Dataset ID: $DATASET_ID"
echo "Using Table ID: $TABLE_ID"
echo "Using Location: $LOCATION"

# Create the dataset if it doesn't exist
bq --location=$LOCATION --project_id=$PROJECT_ID ls --datasets | grep -w $DATASET_ID || \
  bq --location=$LOCATION --project_id=$PROJECT_ID mk --dataset \
    --description "Dataset for VeoSpark analytics" \
    $DATASET_ID

# Define the schema for the new table
SCHEMA='./schema_imagen_history.json'

# Create the table
bq --location=$LOCATION --project_id=$PROJECT_ID mk --table \
  --description "Table for storing Imagen generation history" \
  $PROJECT_ID:$DATASET_ID.$TABLE_ID \
  "$SCHEMA"

echo "Table $TABLE_ID created successfully in dataset $DATASET_ID."
