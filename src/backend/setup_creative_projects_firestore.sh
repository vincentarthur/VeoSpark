#!/bin/bash

# This script sets up the Firestore database and indexes for the Creative Projects feature.
# Before running, make sure you have:
# 1. The Google Cloud SDK installed (https://cloud.google.com/sdk/docs/install).
# 2. Authenticated with gcloud (`gcloud auth login`).
# 3. Set your project with `gcloud config set project YOUR_PROJECT_ID`.

# You can find your project ID in the app-config.yaml file.

# Stop on any error
set -e

echo "Setting up Firestore for Creative Projects..."

PROJECT_ID=$(grep 'PROJECT_ID' app-config.yaml | awk '{print $2}')
DATABASE_ID=$(grep 'CREATIVE_PROJECTS_DB' app-config.yaml | awk '{print $2}')
LOCATION="us-central1" # Using the location from the Vertex AI client initialization in main.py

# Create the Firestore database
echo "Creating Firestore database '$DATABASE_ID' in location '$LOCATION' if it doesn't exist..."
# The command will fail if the database already exists, so we add || true to continue
gcloud firestore databases create --database=$DATABASE_ID --location=$LOCATION --project=$PROJECT_ID --type=firestore-native || echo "Database likely already exists. Continuing..."

# It can take a moment for the database to be ready for index creation.
echo "Waiting for 60 seconds for the database to initialize..."
sleep 60

# Index for querying projects by members
echo "Creating index for 'projects' collection..."
gcloud firestore indexes composite create \
  --project=$PROJECT_ID \
  --database=$DATABASE_ID \
  --collection-group=projects \
  --field-config=field-path=members,array-config=CONTAINS \
  --field-config=field-path=created_at,order=DESCENDING

# Index for querying assets by date
echo "Creating index for 'assets' collection group..."
gcloud firestore indexes composite create \
  --project=$PROJECT_ID \
  --database=$DATABASE_ID \
  --collection-group=assets \
  --field-config=field-path=added_at,order=DESCENDING

echo "Creative Projects Firestore setup complete."
