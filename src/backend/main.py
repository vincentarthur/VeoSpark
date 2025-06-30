import os
import uvicorn
import json
import logging
import re
import yaml
import sys
import tempfile
import time
import uuid
import google.auth
import google.genai as genai

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import FastAPI, Depends, Request, APIRouter, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from starlette.config import Config
from starlette.responses import RedirectResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from urllib.parse import urlparse, urlunparse

from google.cloud import secretmanager, storage, bigquery, firestore
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.genai import types

# Import the new video processing functions
from video_processing import process_video_from_gcs


# ==============================================================================
# NEW HELPER FOR BIGQUERY LOGGING
# ==============================================================================

def log_generation_to_bq(**kwargs):
    """
    Constructs a row and inserts it into the BigQuery history table.
    Ensures that logging does not crash the main application.
    """
    if not app_conf.get('ENABLE_BIGQUERY_LOGGING', False) or not bq_client or not table_ref:
        logger.warning("BigQuery client not configured or logging is disabled. Skipping logging.")
        return

    try:
        # Prepare the row based on the BQ schema
        row_to_insert = {
            "user_email": kwargs.get("user_email"),
            "trigger_time": kwargs.get("trigger_time").isoformat(),
            "completion_time": kwargs.get("completion_time").isoformat(),
            "operation_duration": kwargs.get("operation_duration"),
            "prompt": kwargs.get("prompt"),
            "model_used": kwargs.get("model_used"),
            "status": kwargs.get("status"),
            "error_message": str(kwargs.get("error_message", None)),
            "video_duration": kwargs.get("video_duration"),
            "with_audio": kwargs.get("with_audio"),
            "first_frame_gcs_uri": kwargs.get("first_frame_gcs_uri"),
            "last_frame_gcs_uri": kwargs.get("last_frame_gcs_uri"),
            # Convert list of paths to a JSON string for storage
            "output_video_gcs_paths": json.dumps(kwargs.get("output_video_gcs_paths", [])),
        }

        # Remove None values so BQ doesn't complain about missing columns if not provided
        row_to_insert = {k: v for k, v in row_to_insert.items() if v is not None}

        errors = bq_client.insert_rows_json(table_ref, [row_to_insert])
        if not errors:
            logger.info(f"Successfully logged generation event for user {kwargs.get('user_email')} to BigQuery.")
        else:
            logger.error(f"Encountered errors while inserting rows to BigQuery: {errors}")

    except Exception as e:
        logger.error(f"CRITICAL: Failed to log generation event to BigQuery. Error: {e}", exc_info=True)


# ==============================================================================
# 1. CONFIGURATION AND INITIALIZATION
# ==============================================================================

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("VeoApiServer")

try:
    with open('./app-config.yaml', 'r') as config_file:
        app_conf = yaml.safe_load(config_file)
    logger.info("Successfully loaded app-config.yaml.")
except (FileNotFoundError, yaml.YAMLError) as e:
    logger.critical(f"Could not load or parse 'app-config.yaml'. Error: {e}")
    sys.exit(1)

PROJECT = app_conf.get('PROJECT_ID')
LOCATION = app_conf.get('LOCATION')
BUCKET_NAME = app_conf.get('VIDEO_BUCKET_NAME')

SECRET_ID = app_conf.get('SECRET_ID')
os.environ['GOOGLE_CLOUD_PROJECT'] = PROJECT
os.environ['GOOGLE_CLOUD_LOCATION'] = LOCATION

dataset_id = app_conf.get('ANALYSIS_DATASET')
table_id = app_conf.get('HISTORY_TABLE')
prompt_gallery_collection_id = app_conf.get('PROMPT_GALLERY_COLLECTION')
bq_client = None
db = None
table_ref = None

if app_conf.get('ENABLE_BIGQUERY_LOGGING', False):
    if dataset_id and table_id and PROJECT:
        try:
            bq_client = bigquery.Client(project=PROJECT)
            table_ref = bq_client.dataset(dataset_id).table(table_id)
            bq_client.get_table(table_ref)
            logger.info(f"BigQuery client initialized for table: {PROJECT}.{dataset_id}.{table_id}")
        except Exception as e:
            logger.error(f"Could not initialize BigQuery client. Logging will be disabled. Error: {e}", exc_info=True)
    else:
        logger.warning("BigQuery dataset/table ID not provided. BigQuery logging disabled.")
else:
    logger.info("BigQuery logging is disabled in the configuration.")

try:
    db = firestore.Client(project=PROJECT, database=app_conf.get('PROMPT_GALLERY_DB'))
    logger.info("Firestore client initialized successfully.")
except Exception as e:
    logger.error(f"Could not initialize Firestore client. Error: {e}", exc_info=True)
    db = None


# ==============================================================================
# 2. VEO API CLIENT CLASS
# ==============================================================================

class VeoApiClient:
    def __init__(self, project_id: str, location: str, default_bucket_name: str):
        self.project_id = project_id
        self.location = location
        self.default_bucket_name = default_bucket_name
        self.default_model_id = app_conf.get('GEMINI_MODEL', "veo-2.0-generate-001")
        self.v3_model_id = "veo-3.0-generate-preview"

        try:
            self.logger = logging.getLogger("VeoApiServer")
            self._credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
            self._credentials.refresh(GoogleAuthRequest())
            self.storage_client = storage.Client(project=self.project_id, credentials=self._credentials)
            self.storage_client.get_bucket(self.default_bucket_name)

            self.genai_client = genai.Client(vertexai=True, project=self.project_id, location=self.location)
            self.logger.info("VeoApiClient initialized successfully.")
        except Exception as e:
            self.logger.critical(f"Failed to initialize VeoApiClient. Error: {e}", exc_info=True)
            raise ConnectionError(f"GCP Authentication or GCS/GenAI connection failed: {e}")

    def generate_signed_gcs_url(self, gcs_uri: str, expiration_minutes: int = 60) -> str:
        if not gcs_uri or not gcs_uri.startswith("gs://"):
            return ""
        try:
            bucket_name, blob_name = gcs_uri[5:].split("/", 1)
            bucket = self.storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            return blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=expiration_minutes),
                method="GET",
            )
        except Exception as e:
            self.logger.error(f"Failed to generate signed URL for {gcs_uri}: {e}", exc_info=True)
            return ""

    def generate_video(
            self,
            prompt: str,
            user_info: Optional[Dict[str, Any]],
            **kwargs
    ) -> Tuple[List[str], List[str], float, str]:
        self.logger.info(f"Starting video generation for prompt: '{prompt[:100]}...'")
        start_time = time.time()

        model_id = kwargs.get('model', self.default_model_id)
        aspect_ratio = kwargs.get('aspect_ratio', '16:9')
        duration_seconds = int(kwargs.get('duration_seconds', 8))
        sample_count = int(kwargs.get('sample_count', 1))
        image_gcs_uri = kwargs.get('image_gcs_uri')
        final_frame_gcs_uri = kwargs.get('final_frame_gcs_uri')

        user_folder = "anonymous"
        if user_info and 'email' in user_info:
            user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_info['email']).lower()

        output_gcs_prefix = f"gs://{self.default_bucket_name}/veo_outputs/{user_folder}/{uuid.uuid4().hex}"
        self.logger.info(f"Using user-specific GCS output prefix: '{output_gcs_prefix}'")

        sdk_call_kwargs = {}

        try:
            config = types.GenerateVideosConfig(
                output_gcs_uri=output_gcs_prefix,
                aspect_ratio=aspect_ratio,
                duration_seconds=duration_seconds,
                number_of_videos=sample_count,
            )
            
            # Add image to the generation request if provided
            if image_gcs_uri:
                self.logger.info(f"Using source image for generation: {image_gcs_uri}")
                sdk_call_kwargs['image'] = types.Image(gcs_uri=image_gcs_uri, mime_type="image/jpeg")
            
            if final_frame_gcs_uri and model_id != self.v3_model_id :
                # Only applicable for Veo2
                self.logger.info(f"Using final frame for generation: {final_frame_gcs_uri}")
                config.last_frame = types.Image(gcs_uri=final_frame_gcs_uri, mime_type="image/jpeg")

            if kwargs.get('enhance_prompt') is not None:
                config.enhance_prompt = kwargs['enhance_prompt']

            if model_id == self.v3_model_id:
                if kwargs.get('generate_audio') is not None:
                    config.generate_audio = kwargs['generate_audio']
                self.logger.info(
                    f"Applying Veo 3.0 specifics: Audio={getattr(config, 'generate_audio', 'Default')}, Enhance={getattr(config, 'enhance_prompt', 'Default')}")

            # if model_id == self.exp_model_id:
            #     # This part is a placeholder based on anticipated SDK features.
            #     # You may need to adjust the attribute name, e.g., `config.camera_motion`
            #     # config.camera_control = camera_control
            #     self.logger.warning(
            #         f"Note: Camera controls are for demonstration and may not be fully implemented in the SDK yet.")
            
            if model_id == self.default_model_id and kwargs.get('extend_duration') is not None:
                self.logger.info(f"Applying video extension for model {model_id}")
                sdk_call_kwargs['video'] = types.Video(uri=image_gcs_uri)
                sdk_call_kwargs.pop('image')
                config.duration_seconds = kwargs['extend_duration']

            self.logger.info(f"Submitting video generation request to model '{model_id}'...")
            operation = self.genai_client.models.generate_videos(
                model=model_id,
                prompt=prompt,
                config=config,
                **sdk_call_kwargs
            )

            self.logger.info(f"Operation initiated: '{operation.name}'. Polling for completion...")
            poll_timeout_seconds = 600
            polling_start = time.monotonic()
            while not operation.done:
                elapsed_polling_time = time.monotonic() - polling_start
                if elapsed_polling_time > poll_timeout_seconds:
                    raise TimeoutError(f"Polling timed out after {poll_timeout_seconds}s.")
                time.sleep(15)
                operation = self.genai_client.operations.get(operation)

            if operation.error:
                raise RuntimeError(f"Video generation failed: {operation.error}")
            if not operation.response:
                raise RuntimeError("Operation finished but no response data found.")

            result = operation.result

            self.logger.info(f"Operation Result: '{result}'")

            revised_prompt = None
            # Safely check if the 'revised_prompt' attribute exists on the result
            if hasattr(result, 'revised_prompt') and result.revised_prompt:
                revised_prompt = result.revised_prompt
                self.logger.info(f"Captured enhanced prompt: '{revised_prompt}'")

            generated_videos = operation.result.generated_videos
            if not generated_videos:
                self.logger.warning("Operation completed but no videos were returned.")
                return [], [], time.time() - start_time, revised_prompt

            generated_gcs_uris = [v.video.uri for v in generated_videos if v.video and v.video.uri]
            self.logger.info(f"Found {len(generated_gcs_uris)} generated video GCS URIs.")
            total_time = time.time() - start_time
            return [], generated_gcs_uris, total_time, revised_prompt

        except Exception as e:
            self.logger.error(f"An error occurred during the generate_video process: {e}", exc_info=True)
            raise


# ==============================================================================
# 3. FASTAPI APP AND MIDDLEWARE SETUP
# ==============================================================================

app = FastAPI(title="Veo Generation API")
api_router = APIRouter(prefix="/api")

SECRET_KEY = os.environ.get('SECRET_KEY', 'a-very-secret-key-for-dev')
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=7200)

origins = [
    app_conf.get("FRONTEND_URL", "http://localhost:3000"),
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================================================================
# 4. AUTHENTICATION (OAUTH)
# ==============================================================================

def get_oauth_secrets(secret_id, version_id="latest"):
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{PROJECT}/secrets/{secret_id}/versions/{version_id}"
    try:
        response = client.access_secret_version(name=name)
        return response.payload.data.decode('UTF-8')
    except Exception as e:
        logger.critical(f"Failed to access secret '{secret_id}'. Error: {e}", exc_info=True)
        sys.exit(1)


if app_conf.get('ENABLE_OAUTH', False):

    secrets_str = get_oauth_secrets(SECRET_ID)
    secrets = json.loads(secrets_str)
    ALLOWED_DOMAINS = app_conf.get('ALLOWED_DOMAINS', [])

    config_data = {
        'GOOGLE_CLIENT_ID': secrets.get('GOOGLE_CLIENT_ID'),
        'GOOGLE_CLIENT_SECRET': secrets.get('GOOGLE_CLIENT_SECRET'),
    }
    starlette_config = Config(environ=config_data)
    oauth = OAuth(starlette_config)
    oauth.register(
        name='google',
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={'scope': 'openid email profile'},
    )


    @app.get('/login')
    async def login(request: Request):
        redirect_uri = app_conf.get("REDIRECT_URI", "http://localhost:7860/auth")
        return await oauth.google.authorize_redirect(request, redirect_uri)


    @app.get('/auth')
    async def auth(request: Request):
        frontend_url = app_conf.get("FRONTEND_URL", "http://localhost:3000")
        try:
            token = await oauth.google.authorize_access_token(request)
            user_info = dict(token)["userinfo"]

            user_hd = user_info.get('hd')
            if ALLOWED_DOMAINS and user_hd not in ALLOWED_DOMAINS:
                logger.warning(f"Unauthorized domain: {user_hd}")
                return RedirectResponse(url=f"{frontend_url}/login?error=domain_not_allowed")

            request.session['user'] = user_info
            return RedirectResponse(url=frontend_url)
        except OAuthError as e:
            logger.error(f"OAuth Error: {e}", exc_info=True)
            return RedirectResponse(url=f"{frontend_url}/login?error=oauth_failed")


    @app.get('/logout')
    async def logout(request: Request):
        request.session.pop('user', None)
        frontend_url = app_conf.get("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(url=f"{frontend_url}/login")


def get_user(request: Request) -> Optional[dict]:
    return request.session.get('user')


# ==============================================================================
# 5. API ENDPOINTS
# ==============================================================================

@api_router.get("/user/me", tags=["User"])
def get_current_user_details(user: dict = Depends(get_user)):
    if not user:
        return JSONResponse({"authenticated": False}, status_code=401)

    cost_managers = app_conf.get('COST_MANAGERS', [])
    user_email = user.get('email')
    is_cost_manager = user_email in cost_managers

    return JSONResponse({
        "authenticated": True,
        "name": user.get('name'),
        "email": user_email,
        "picture": user.get('picture'),
        "is_cost_manager": is_cost_manager,
    })


@api_router.get("/config", tags=["Configuration"])
def get_app_config():
    """
    Returns public configuration details to the frontend.
    """
    return JSONResponse({
        "prompt_gallery_name": app_conf.get("PROMPT_GALLERY_COLLECTION", "prompts")
    })


@api_router.post("/videos/generate", tags=["Video Generation"])
async def generate_video_endpoint(request: Request, user: dict = Depends(get_user)):
    if app_conf.get('ENABLE_OAUTH', False) and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    body = await request.json()

    if not body.get('prompt'):
        raise HTTPException(status_code=400, detail="Prompt is required.")

    try:
        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize Veo client: {e}")

    # --- Prepare logging data ---
    trigger_time = datetime.now(timezone.utc)
    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    model_used = body.get('model')
    prompt = body.get('prompt')
    requested_duration = body.get('duration')
    image_gcs_uri = body.get('image_gcs_uri')
    final_frame_gcs_uri = body.get('final_frame_gcs_uri')
    with_audio = body.get('generateAudio', False)

    try:
            # --- Call the generation function ---
        _, gcs_paths, op_duration, revised_prompt = veo_client.generate_video(
            prompt=prompt,
            user_info=user,
            model=model_used,
            aspect_ratio=body.get('aspectRatio'),
            duration_seconds=requested_duration,
            sample_count=body.get('sampleCount'),
            image_gcs_uri=image_gcs_uri, # Pass image URI to the client
            final_frame_gcs_uri=final_frame_gcs_uri,
            generate_audio=body.get('generateAudio'),
            enhance_prompt=body.get('enhancePrompt'),
            extend_duration=body.get('extend_duration')
        )

        # --- Log SUCCESS to BigQuery for each generated video ---
        completion_time = datetime.now(timezone.utc)
        if model_used == 'veo-2.0-generate-001':
            for path in gcs_paths:
                log_generation_to_bq(
                    user_email=user_email,
                    trigger_time=trigger_time,
                    completion_time=completion_time,
                    operation_duration=op_duration / len(gcs_paths) if gcs_paths else 0, # Apportion duration
                    prompt=prompt,
                    model_used=model_used,
                    status="SUCCESS",
                    error_message=None,
                    video_duration=requested_duration,
                    with_audio=with_audio,
                    first_frame_gcs_uri=image_gcs_uri,
                    last_frame_gcs_uri=final_frame_gcs_uri,
                    output_video_gcs_paths=[path]  # Log each path individually
                )

        # --- Return response to frontend ---
        video_data = []
        for uri in gcs_paths:
            signed_url = veo_client.generate_signed_gcs_url(uri)
            if signed_url:
                video_data.append({
                    "gcs_uri": uri,
                    "signed_url": signed_url
                })
        
        return JSONResponse({
            "message": "Video generation successful.",
            "videos": video_data,
            "duration": op_duration,
            "revisedPrompt": revised_prompt
        }, status_code=200)

    except Exception as e:
        # --- Log FAILURE to BigQuery ---
        log_generation_to_bq(
            user_email=user_email,
            trigger_time=trigger_time,
            completion_time=datetime.now(timezone.utc),
            operation_duration=time.monotonic() - trigger_time.timestamp(),  # Approximate duration until failure
            prompt=prompt,
            model_used=model_used,
            status="FAILURE",
            error_message=e,
            video_duration=requested_duration,
            with_audio=with_audio,
            first_frame_gcs_uri=image_gcs_uri,
            last_frame_gcs_uri=final_frame_gcs_uri,
            output_video_gcs_paths=[]
        )

        logger.error(f"Video generation failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video generation failed: {e}")


@api_router.get("/gcs/videos", tags=["GCS"])
def list_user_videos(user: dict = Depends(get_user), prefix: Optional[str] = None):
    """
    Lists all video files in the user's GCS folder, optionally filtered by a prefix.
    """
    if app_conf.get('ENABLE_OAUTH', False) and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
    
    # If a prefix is provided by the client, use it. Otherwise, default to the user's folder.
    search_prefix = prefix if prefix else f"veo_outputs/{user_folder}/"

    try:
        storage_client = storage.Client(project=PROJECT)
        storage_client = storage.Client(project=PROJECT)
        bucket = storage_client.bucket(BUCKET_NAME)
        blobs = bucket.list_blobs(prefix=search_prefix)

        videos = []
        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
        for blob in blobs:
            if blob.name.lower().endswith(('.mp4', '.mov', '.avi', '.mkv')):
                gcs_uri = f"gs://{BUCKET_NAME}/{blob.name}"
                signed_url = veo_client.generate_signed_gcs_url(gcs_uri)
                videos.append({
                    "name": blob.name,
                    "gcs_uri": gcs_uri,
                    "signed_url": signed_url
                })
        
        return JSONResponse({"videos": videos, "prefix": search_prefix})
    except Exception as e:
        logger.error(f"Failed to list videos for user {user_email} from GCS. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to list videos from GCS.")


@api_router.post("/prompts", tags=["Prompt Gallery"])
async def add_prompt_to_gallery(request: Request, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not db:
        raise HTTPException(status_code=503, detail="Firestore is not configured")

    body = await request.json()
    prompt_text = body.get("prompt_text")
    keywords = body.get("keywords", [])

    if not prompt_text:
        raise HTTPException(status_code=400, detail="Prompt text is required.")

    doc_ref = db.collection(prompt_gallery_collection_id).document()
    doc_ref.set({
        "prompt_text": prompt_text,
        "keywords": keywords,
        "created_by_email": user.get("email"),
        "created_by_name": user.get("name"),
        "created_at": firestore.SERVER_TIMESTAMP
    })
    return JSONResponse({"message": "Prompt added successfully", "id": doc_ref.id}, status_code=201)


@api_router.get("/prompts", tags=["Prompt Gallery"])
def get_prompts_from_gallery(tags: Optional[str] = None):
    if not db:
        raise HTTPException(status_code=503, detail="Firestore is not configured")

    prompts_ref = db.collection(prompt_gallery_collection_id)
    query = prompts_ref.order_by("created_at", direction=firestore.Query.DESCENDING)
    
    prompts = []
    tag_list = [tag.strip() for tag in tags.split(',')] if tags else []

    for doc in query.stream():
        prompt_data = doc.to_dict()
        if tags and not all(tag in prompt_data.get("keywords", []) for tag in tag_list):
            continue
        prompt_data = doc.to_dict()
        prompt_data["id"] = doc.id
        if 'created_at' in prompt_data and hasattr(prompt_data['created_at'], 'isoformat'):
            prompt_data['created_at'] = prompt_data['created_at'].isoformat()
        prompts.append(prompt_data)

    return JSONResponse(prompts)


@api_router.delete("/prompts/{prompt_id}", tags=["Prompt Gallery"])
def delete_prompt_from_gallery(prompt_id: str, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not db:
        raise HTTPException(status_code=503, detail="Firestore is not configured")

    doc_ref = db.collection(prompt_gallery_collection_id).document(prompt_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Prompt not found")

    if doc.to_dict().get("created_by_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only delete your own prompts")

    doc_ref.delete()
    return JSONResponse({"message": "Prompt deleted successfully"})


@api_router.get("/videos/history", tags=["Video Generation"])
def get_user_history(
    request: Request,
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
    model: Optional[str] = None,
    is_edited: Optional[bool] = False
):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not app_conf.get('ENABLE_BIGQUERY_LOGGING', False) or not bq_client:
        logger.warning(f"Attempted to access history for {user.get('email')} but BigQuery is disabled.")
        return JSONResponse([], status_code=200)

    user_email = user.get('email')
    
    query_params = [bigquery.ScalarQueryParameter("user_email", "STRING", user_email)]
    where_clauses = ["user_email = @user_email"]

    if start_date:
        where_clauses.append("trigger_time >= @start_date")
        query_params.append(bigquery.ScalarQueryParameter("start_date", "TIMESTAMP", start_date))
    if end_date:
        # Add 1 day to end_date to make it inclusive
        end_date_inclusive = (datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)).isoformat()
        where_clauses.append("trigger_time < @end_date")
        query_params.append(bigquery.ScalarQueryParameter("end_date", "TIMESTAMP", end_date_inclusive))
    if status:
        where_clauses.append("status = @status")
        query_params.append(bigquery.ScalarQueryParameter("status", "STRING", status))
    if model:
        where_clauses.append("model_used = @model")
        query_params.append(bigquery.ScalarQueryParameter("model", "STRING", model))
    if is_edited:
        where_clauses.append("model_used LIKE 'EDITING_TOOL_%'")

    query = f"""
        SELECT
            user_email,
            CAST(trigger_time AS STRING) AS trigger_time,
            CAST(completion_time AS STRING) AS completion_time,
            prompt,
            model_used,
            output_video_gcs_paths,
            operation_duration,
            video_duration,
            status,
            error_message,
            first_frame_gcs_uri,
            last_frame_gcs_uri
        FROM
            `{PROJECT}.{dataset_id}.{table_id}`
        WHERE {" AND ".join(where_clauses)} ORDER BY trigger_time DESC
    """
    
    job_config = bigquery.QueryJobConfig(query_parameters=query_params)

    try:
        query_job = bq_client.query(query, job_config=job_config)
        rows = [dict(row) for row in query_job.result()]

        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
        for row in rows:
            gcs_paths_str = row.get("output_video_gcs_paths", "[]")
            try:
                gcs_paths = json.loads(gcs_paths_str)
                signed_urls = [veo_client.generate_signed_gcs_url(uri) for uri in gcs_paths]
                row["signed_urls"] = [url for url in signed_urls if url]
                # Extract video name from the first GCS path
                if gcs_paths:
                    row["video_name"] = Path(gcs_paths[0]).name
                else:
                    row["video_name"] = None
            except (json.JSONDecodeError, TypeError):
                row["signed_urls"] = []
                row["video_name"] = None

        return JSONResponse(rows)

    except Exception as e:
        logger.error(f"Error querying history for user {user_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve history.")


@api_router.post("/images/upload", tags=["Image Upload"])
async def upload_image_endpoint(user: dict = Depends(get_user), file: UploadFile = File(...)):
    """
    Uploads an image to GCS and returns its URI.
    """
    if app_conf.get('ENABLE_OAUTH', False) and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Only images are allowed.")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
    
    try:
        storage_client = storage.Client(project=PROJECT)
        bucket = storage_client.bucket(BUCKET_NAME)
        
        # Create a unique blob name
        file_extension = Path(file.filename).suffix
        blob_name = f"image_uploads/{user_folder}/{uuid.uuid4().hex}{file_extension}"
        blob = bucket.blob(blob_name)

        # Upload the file
        blob.upload_from_file(file.file, content_type=file.content_type)
        
        gcs_uri = f"gs://{BUCKET_NAME}/{blob_name}"
        logger.info(f"User {user_email} uploaded image to {gcs_uri}")

        return JSONResponse({
            "message": "Image uploaded successfully.",
            "gcs_uri": gcs_uri
        }, status_code=200)

    except Exception as e:
        logger.error(f"Image upload failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image upload failed: {e}")


@api_router.post("/videos/edit", tags=["Video Editing"])
async def edit_video_endpoint(request: Request, user: dict = Depends(get_user)):
    """
    Edits a video based on the provided parameters (e.g., clipping).
    """
    if app_conf.get('ENABLE_OAUTH', False) and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    body = await request.json()
    gcs_uri = body.get('gcs_uri')
    start_time = body.get('start_time')
    end_time = body.get('end_time')

    if not gcs_uri:
        raise HTTPException(status_code=400, detail="gcs_uri is required.")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
    trigger_time = datetime.now(timezone.utc)

    try:
        op_start_time = time.time()
        processed_gcs_uri, new_duration = process_video_from_gcs(
            project_id=PROJECT,
            gcs_uri=gcs_uri,
            operation='clip',
            user_folder=user_folder,
            start_time=start_time,
            end_time=end_time
        )
        op_duration = time.time() - op_start_time

        # Log the clipping event to BigQuery
        log_generation_to_bq(
            user_email=user_email,
            trigger_time=trigger_time,
            completion_time=datetime.now(timezone.utc),
            operation_duration=op_duration,
            prompt=f"Clipped from {Path(gcs_uri).name}",
            model_used="EDITING_TOOL_CLIP",
            status="SUCCESS",
            video_duration=new_duration,
            with_audio=None,
            output_video_gcs_paths=[processed_gcs_uri]
        )

        # Generate a signed URL for the new video
        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
        signed_url = veo_client.generate_signed_gcs_url(processed_gcs_uri)

        return JSONResponse({
            "message": "Video clipped successfully.",
            "processed_video_uri": processed_gcs_uri,
            "signed_url": signed_url
        }, status_code=200)

    except Exception as e:
        logger.error(f"Video editing failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video editing failed: {e}")


@api_router.post("/videos/dub", tags=["Video Editing"])
async def dub_video_endpoint(request: Request, user: dict = Depends(get_user)):
    """
    Adds a text-to-speech voiceover to a video.
    """
    if app_conf.get('ENABLE_OAUTH', False) and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    body = await request.json()
    gcs_uri = body.get('gcs_uri')
    text = body.get('text')

    if not gcs_uri or not text:
        raise HTTPException(status_code=400, detail="gcs_uri and text are required.")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
    trigger_time = datetime.now(timezone.utc)

    try:
        op_start_time = time.time()
        processed_gcs_uri, new_duration = process_video_from_gcs(
            project_id=PROJECT,
            gcs_uri=gcs_uri,
            operation='dub',
            user_folder=user_folder,
            text=text
        )
        op_duration = time.time() - op_start_time

        # Log the dubbing event to BigQuery
        log_generation_to_bq(
            user_email=user_email,
            trigger_time=trigger_time,
            completion_time=datetime.now(timezone.utc),
            operation_duration=op_duration,
            prompt=f"Dubbed from {Path(gcs_uri).name}",
            model_used="EDITING_TOOL_DUB",
            status="SUCCESS",
            video_duration=new_duration,
            with_audio=True,
            output_video_gcs_paths=[processed_gcs_uri]
        )

        # Generate a signed URL for the new video
        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
        signed_url = veo_client.generate_signed_gcs_url(processed_gcs_uri)

        return JSONResponse({
            "message": "Voiceover added successfully.",
            "processed_video_uri": processed_gcs_uri,
            "signed_url": signed_url
        }, status_code=200)

    except Exception as e:
        logger.error(f"Video dubbing failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video dubbing failed: {e}")


@api_router.get("/analytics/consumption", tags=["Analytics"])
def get_consumption_analytics(
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    Provides aggregated consumption data by calculating cost on the fly.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    cost_managers = app_conf.get('COST_MANAGERS', [])
    if user.get('email') not in cost_managers:
        raise HTTPException(status_code=403, detail="You do not have permission to view analytics.")

    if not app_conf.get('ENABLE_BIGQUERY_LOGGING', False) or not bq_client:
        raise HTTPException(status_code=501, detail="Analytics are disabled (BigQuery not configured).")

    query_params = []
    where_clauses = ["status = 'SUCCESS'", "video_duration > 0"]

    if start_date:
        where_clauses.append("trigger_time >= @start_date")
        query_params.append(bigquery.ScalarQueryParameter("start_date", "TIMESTAMP", start_date))
    if end_date:
        end_date_inclusive = (datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)).isoformat()
        where_clauses.append("trigger_time < @end_date")
        query_params.append(bigquery.ScalarQueryParameter("end_date", "TIMESTAMP", end_date_inclusive))

    query = f"""
        SELECT
            trigger_time,
            user_email,
            model_used,
            video_duration,
            with_audio
        FROM `{PROJECT}.{dataset_id}.{table_id}`
        WHERE {" AND ".join(where_clauses)}
    """
    
    job_config = bigquery.QueryJobConfig(query_parameters=query_params)

    def calculate_cost(model_used: str, video_duration: float, with_audio: Optional[bool]) -> float:
        if not model_used or not video_duration: return 0.0
        cost_per_second = 0.0
        if 'veo-3.0' in model_used:
            # Assume with_audio is true for old data where the field is NULL
            cost_per_second = 0.75 if with_audio is not False else 0.50
        elif 'veo-2.0' in model_used:
            cost_per_second = 0.50
        return round(video_duration * cost_per_second, 4)

    try:
        query_job = bq_client.query(query, job_config=job_config)
        rows = query_job.result()

        daily_costs = {}
        user_costs = {}
        total_cost = 0

        for row in rows:
            cost = calculate_cost(row.model_used, row.video_duration, row.with_audio)
            total_cost += cost
            if cost > 0:
                # Aggregate daily costs
                consumption_date = row.trigger_time.strftime('%Y-%m-%d')
                daily_costs[consumption_date] = daily_costs.get(consumption_date, 0) + cost
                
                # Aggregate user costs
                user_costs[row.user_email] = user_costs.get(row.user_email, 0) + cost

        # Format for recharts
        daily_consumption_chart_data = [
            {"consumption_date": date, "total_cost": round(cost, 2)}
            for date, cost in sorted(daily_costs.items())
        ]
        
        top_users_chart_data = sorted(
            [{"user_email": email, "total_cost": round(cost, 2)} for email, cost in user_costs.items()],
            key=lambda x: x["total_cost"],
            reverse=True
        )[:5]

        # Query 3: Model Usage Distribution
        model_dist_query = f"""
            SELECT
                model_used,
                with_audio,
                COUNT(*) as generation_count
            FROM `{PROJECT}.{dataset_id}.{table_id}`
            WHERE {" AND ".join(where_clauses)} AND model_used LIKE 'veo-%'
            GROUP BY model_used, with_audio
        """
        model_dist_job = bq_client.query(model_dist_query, job_config=job_config)
        model_dist_results = [dict(row) for row in model_dist_job.result()]

        return JSONResponse({
            "total_cost": round(total_cost, 2),
            "daily_consumption": daily_consumption_chart_data,
            "top_users": top_users_chart_data,
            "model_distribution": model_dist_results
        })

    except Exception as e:
        logger.error(f"Failed to execute analytics query. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve analytics data.")


# ==============================================================================
# 6. APP ROUTING AND STARTUP
# ==============================================================================

app.include_router(api_router)


@app.get("/", tags=["Health Check"])
def read_root():
    return {"status": "Veo API is healthy and running"}


if __name__ == '__main__':
    port = int(os.getenv("PORT", "7860"))
    logger.info(f"Starting Uvicorn server on http://0.0.0.0:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
