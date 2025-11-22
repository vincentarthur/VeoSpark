from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from app.config import settings
from app.dependencies import get_storage_client, get_user
from google.cloud import storage
import cv2
import numpy as np
import requests
import os
import uuid
import tempfile
import logging
import time
from datetime import timedelta
import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest

router = APIRouter()
logger = logging.getLogger(__name__)

class SignUrlRequest(dict):
    def __init__(self, gcs_uri: str):
        self.gcs_uri = gcs_uri

def generate_signed_url(blob, expiration_minutes=60):
    try:
        creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        creds.refresh(GoogleAuthRequest())
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expiration_minutes),
            method="GET",
            service_account_email=creds.service_account_email,
            access_token=creds.token,
        )
    except Exception as e:
        logger.error(f"Failed to generate signed URL: {e}")
        return ""

@router.post("/sign_url")
async def sign_url_endpoint(
    request: dict, # Using dict for simplicity or Pydantic model
    user: dict = Depends(get_user),
    storage_client: storage.Client = Depends(get_storage_client)
):
    if settings.ENABLE_OAUTH and not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    gcs_uri = request.get('gcs_uri')
    if not gcs_uri:
        raise HTTPException(status_code=400, detail="gcs_uri is required")

    try:
        bucket_name, blob_name = gcs_uri[5:].split("/", 1)
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        
        signed_url = generate_signed_url(blob)
        
        if not signed_url:
             raise HTTPException(status_code=500, detail="Failed to generate signed URL")
             
        return {"signed_url": signed_url}
    except Exception as e:
        logger.error(f"Error signing URL: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/capture_frame")
async def capture_frame(
    video_file: UploadFile = File(None),
    video_url: str = Form(None),
    timestamp: float = Form(...),
    user: dict = Depends(get_user),
    storage_client: storage.Client = Depends(get_storage_client)
):
    if settings.ENABLE_OAUTH and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    user_folder = "".join(c if c.isalnum() else "_" for c in user_email).lower()
    
    temp_video_path = None
    cap = None

    try:
        # Create a temporary file for the video
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            temp_video_path = tmp.name
            
            if video_file:
                content = await video_file.read()
                tmp.write(content)
            elif video_url:
                # Download video from URL
                # If it's a GCS URL, we might need to sign it or use storage client, 
                # but here we assume it's a signed URL or public URL provided by frontend
                response = requests.get(video_url, stream=True)
                response.raise_for_status()
                for chunk in response.iter_content(chunk_size=8192):
                    tmp.write(chunk)
            else:
                raise HTTPException(status_code=400, detail="Either video_file or video_url must be provided")

        # Capture frame using OpenCV
        cap = cv2.VideoCapture(temp_video_path)
        if not cap.isOpened():
            raise HTTPException(status_code=500, detail="Failed to open video file")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_number = int(timestamp * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        
        success, frame = cap.read()
        if not success:
             raise HTTPException(status_code=500, detail="Failed to capture frame at specified timestamp")

        # Encode frame to JPEG
        success, buffer = cv2.imencode('.jpg', frame)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to encode captured frame")
            
        frame_bytes = buffer.tobytes()

        # Upload to GCS
        bucket = storage_client.bucket(settings.VIDEO_BUCKET_NAME)
        blob_name = f"captured_frames/{user_folder}/{uuid.uuid4().hex}.jpg"
        blob = bucket.blob(blob_name)
        blob.upload_from_string(frame_bytes, content_type="image/jpeg")

        gcs_uri = f"gs://{settings.VIDEO_BUCKET_NAME}/{blob_name}"
        signed_url = generate_signed_url(blob)

        logger.info(f"Frame captured and uploaded to {gcs_uri} for user {user_email}")

        return {
            "message": "Frame captured successfully",
            "gcs_uri": gcs_uri,
            "signed_url": signed_url
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error capturing frame: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cap:
            cap.release()
        if temp_video_path and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
