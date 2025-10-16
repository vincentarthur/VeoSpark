#!/bin/bash
# This script automates the setup of the complete Google Cloud environment for the VeoSpark application.
# It is designed to be idempotent and can be run multiple times without causing errors.
#
# Usage:
# 1. Authenticate with gcloud: `gcloud auth application-default login`
# 2. Set your project: `gcloud config set project YOUR_PROJECT_ID`
# 3. Run the script from the `src/backend` directory:
#    ./scripts/setup_environment.sh

# Exit immediately if a command exits with a non-zero status.
set -e

# --- 1. Source Configuration from app-config.yaml ---
echo "INFO: Reading configuration from app-config.yaml..."
PROJECT_ID=$(gcloud config get-value project)
LOCATION=$(grep 'BIGQUERY_LOCATION:' configs/app-config.yaml | awk '{print $2}')
ANALYSIS_DATASET=$(grep 'ANALYSIS_DATASET:' configs/app-config.yaml | awk '{print $2}')
VEO_HISTORY_TABLE=$(grep 'HISTORY_TABLE:' configs/app-config.yaml | awk '{print $2}')
IMAGEN_HISTORY_TABLE=$(grep 'IMAGEN_HISTORY_TABLE:' configs/app-config.yaml | awk '{print $2}')
IMAGE_ENRICHMENT_HISTORY_TABLE=$(grep 'IMAGE_ENRICHMENT_HISTORY_TABLE:' configs/app-config.yaml | awk '{print $2}')
BIGQUERY_CONNECTION_REGION=$(grep 'BIGQUERY_CONNECTION_REGION:' configs/app-config.yaml | awk '{print $2}')
BIGQUERY_CONNECTION_NAME=$(grep 'BIGQUERY_CONNECTION_NAME:' configs/app-config.yaml | awk '{print $2}')
BIGQUERY_MODEL_NAME=$(grep 'BIGQUERY_MODEL_NAME:' configs/app-config.yaml | awk '{print $2}')

# --- 2. Create BigQuery Resources ---
echo "INFO: Creating BigQuery dataset '$ANALYSIS_DATASET' if it doesn't exist..."
bq --location=$LOCATION mk --dataset --description "Dataset for VeoSpark history" "$ANALYSIS_DATASET" 2>/dev/null || echo "INFO: Dataset '$ANALYSIS_DATASET' already exists."

echo "INFO: Creating BigQuery tables if they don't exist..."
bq mk --table --description "VeoSpark generation history" "$ANALYSIS_DATASET.$VEO_HISTORY_TABLE" "schemas/veo_history.json" 2>/dev/null || echo "INFO: Table '$ANALYSIS_DATASET.$VEO_HISTORY_TABLE' already exists."
bq mk --table --description "Imagen generation history" "$ANALYSIS_DATASET.$IMAGEN_HISTORY_TABLE" "schemas/imagen_history.json" 2>/dev/null || echo "INFO: Table '$ANALYSIS_DATASET.$IMAGEN_HISTORY_TABLE' already exists."
bq mk --table --description "Image Enrichment history" "$ANALYSIS_DATASET.$IMAGE_ENRICHMENT_HISTORY_TABLE" "schemas/image_enrichment_history.json" 2>/dev/null || echo "INFO: Table '$ANALYSIS_DATASET.$IMAGE_ENRICHMENT_HISTORY_TABLE' already exists."

# --- 3. Create BigQuery Connection for Vertex AI ---
echo "INFO: Creating BigQuery connection '$BIGQUERY_CONNECTION_NAME' if it doesn't exist..."
if ! bq show --connection "$PROJECT_ID.$BIGQUERY_CONNECTION_REGION.$BIGQUERY_CONNECTION_NAME" &>/dev/null; then
    bq mk --connection --location="$BIGQUERY_CONNECTION_REGION" --project_id="$PROJECT_ID" \
        --connection_type=CLOUD_RESOURCE "$BIGQUERY_CONNECTION_NAME"
    echo "INFO: Connection '$BIGQUERY_CONNECTION_NAME' created."
else
    echo "INFO: Connection '$BIGQUERY_CONNECTION_NAME' already exists."
fi

# --- 4. Provide IAM Instructions ---
SERVICE_ACCOUNT_ID=$(bq show --connection "$PROJECT_ID.$BIGQUERY_CONNECTION_REGION.$BIGQUERY_CONNECTION_NAME" | grep "serviceAccountId" | awk '{print $2}' | tr -d '"')
echo "======================================================================================"
echo "IMPORTANT: Manual Action Required"
echo "======================================================================================"
echo "Please grant the 'Vertex AI User' role to the following service account in the IAM console:"
echo ""
echo "Service Account: $SERVICE_ACCOUNT_ID"
echo ""
echo "You can do this by running the following gcloud command:"
echo "gcloud projects add-iam-policy-binding $PROJECT_ID --member=\"serviceAccount:$SERVICE_ACCOUNT_ID\" --role=\"roles/aiplatform.user\""
echo "======================================================================================"
read -p "Press [Enter] to continue after granting the necessary IAM permissions..."

# --- 5. Create BigQuery Model and Functions ---
echo "INFO: Creating BigQuery embedding model and table functions..."

# A - Create Embedding Model Entrypoint in BigQuery
SQL_MODEL="CREATE OR REPLACE MODEL \`$PROJECT_ID.$ANALYSIS_DATASET.$BIGQUERY_MODEL_NAME\`
  REMOTE WITH CONNECTION \`$PROJECT_ID.$BIGQUERY_CONNECTION_REGION.$BIGQUERY_CONNECTION_NAME\`
  OPTIONS (
    endpoint = 'multimodalembedding@001'
  );"
echo "INFO: Creating embedding model..."
bq query --use_legacy_sql=false "$SQL_MODEL"

# B - Create Table Functions
echo "INFO: Creating table function for Imagen History..."
SQL_FUNC_IMAGEN="CREATE OR REPLACE TABLE FUNCTION \`$PROJECT_ID.$ANALYSIS_DATASET.FindSimilarImages_ImagenHistory\` (query_text STRING, user_email STRING, top_k INT64)
RETURNS TABLE<user_email STRING, trigger_time TIMESTAMP, completion_time TIMESTAMP, prompt STRING, model_used STRING, aspect_ratio STRING, output_image_gcs_path STRING, status STRING, resolution STRING, creative_project_id STRING, error_message STRING, operation_duration FLOAT64, similarity FLOAT64>
AS (
  WITH QueryEmbedding AS (
    SELECT ml_generate_embedding_result as text_embedding
    FROM ML.GENERATE_EMBEDDING(MODEL \`$PROJECT_ID.$ANALYSIS_DATASET.$BIGQUERY_MODEL_NAME\`, (SELECT query_text AS content))
  )
  SELECT base.*, 1 - ML.DISTANCE(base.image_embedding, QueryEmbedding.text_embedding, 'COSINE') AS similarity
  FROM \`$PROJECT_ID.$ANALYSIS_DATASET.imagen_history\` AS base
  CROSS JOIN QueryEmbedding
  WHERE base.status = 'SUCCESS' AND base.user_email = user_email
  QUALIFY ROW_NUMBER() OVER (ORDER BY similarity DESC) <= top_k
  ORDER BY similarity DESC
);"
bq query --use_legacy_sql=false "$SQL_FUNC_IMAGEN"

echo "INFO: Creating table function for Image Enrichment History..."
SQL_FUNC_ENRICHMENT="CREATE OR REPLACE TABLE FUNCTION \`$PROJECT_ID.$ANALYSIS_DATASET.FindSimilarImages_EnrichmentHistory\` (query_text STRING, user_email STRING, top_k INT64)
RETURNS TABLE<user_email STRING, trigger_time TIMESTAMP, completion_time TIMESTAMP, prompt STRING, model_used STRING, aspect_ratio STRING, output_image_gcs_path STRING, status STRING, resolution STRING, creative_project_id STRING, error_message STRING, operation_duration FLOAT64, similarity FLOAT64>
AS (
  WITH QueryEmbedding AS (
    SELECT ml_generate_embedding_result as text_embedding
    FROM ML.GENERATE_EMBEDDING(MODEL \`$PROJECT_ID.$ANALYSIS_DATASET.$BIGQUERY_MODEL_NAME\`, (SELECT query_text AS content))
  )
  SELECT base.*, 1 - ML.DISTANCE(base.image_embedding, QueryEmbedding.text_embedding, 'COSINE') AS similarity
  FROM \`$PROJECT_ID.$ANALYSIS_DATASET.image_enrichment_history\` AS base
  CROSS JOIN QueryEmbedding
  WHERE base.status = 'SUCCESS' AND base.user_email = user_email
  QUALIFY ROW_NUMBER() OVER (ORDER BY similarity DESC) <= top_k
  ORDER BY similarity DESC
);"
bq query --use_legacy_sql=false "$SQL_FUNC_ENRICHMENT"

echo "INFO: Creating table function for Veo History..."
SQL_FUNC_VEO="CREATE OR REPLACE TABLE FUNCTION \`$PROJECT_ID.$ANALYSIS_DATASET.FindSimilarVideos_VeoHistory\` (query_text STRING, user_email STRING, top_k INT64)
RETURNS TABLE<user_email STRING, trigger_time TIMESTAMP, completion_time TIMESTAMP, prompt STRING, model_used STRING, aspect_ratio STRING, output_video_gcs_paths STRING, video_duration INTEGER, status STRING, resolution STRING, creative_project_id STRING, error_message STRING, operation_duration FLOAT64, similarity FLOAT64>
AS (
  WITH QueryEmbedding AS (
    SELECT ml_generate_embedding_result as text_embedding
    FROM ML.GENERATE_EMBEDDING(MODEL \`$PROJECT_ID.$ANALYSIS_DATASET.$BIGQUERY_MODEL_NAME\`, (SELECT query_text AS content))
  )
  SELECT base.*, 1 - ML.DISTANCE(base.video_embedding, QueryEmbedding.text_embedding, 'COSINE') AS similarity
  FROM \`$PROJECT_ID.$ANALYSIS_DATASET.veo_history\` AS base
  CROSS JOIN QueryEmbedding
  WHERE base.status = 'SUCCESS' AND base.user_email = user_email
  QUALIFY ROW_NUMBER() OVER (ORDER BY similarity DESC) <= top_k
  ORDER BY similarity DESC
);"
bq query --use_legacy_sql=false "$SQL_FUNC_VEO"

echo "======================================================================================"
echo "✅ Environment setup complete!"
echo "======================================================================================"
