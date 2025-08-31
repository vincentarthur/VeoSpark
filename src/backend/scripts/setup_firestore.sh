#!/bin/bash

# This script deploys Firestore indexes to your Google Cloud project.
# Before running, make sure you have:
# 1. The Google Cloud SDK installed (https://cloud.google.com/sdk/docs/install).
# 2. Authenticated with gcloud (`gcloud auth login`).
# 3. Set your project with `gcloud config set project YOUR_PROJECT_ID`.

# You can find your project ID in the app-config.yaml file.

# Stop on any error
set -e

echo "Deploying Firestore indexes..."

# Around 2-3 minutes
gcloud firestore indexes composite create --field-config=firestore_index.json --project=$(grep 'PROJECT_ID' app-config.yaml | awk '{print $2}') --database=$(grep 'PROMPT_GALLERY_DB' app-config.yaml | awk '{print $2}') --query-scope=collection --collection-group=prompts
gcloud firestore indexes composite create --field-config=firestore_index_shared_video.json --project=$(grep 'PROJECT_ID' app-config.yaml | awk '{print $2}') --database=$(grep 'SHARED_VIDEOS_DB' app-config.yaml | awk '{print $2}') --query-scope=collection --collection-group=$(grep 'SHARED_VIDEOS_COLLECTION' app-config.yaml | awk '{print $2}')

echo "Firestore index setup complete."
