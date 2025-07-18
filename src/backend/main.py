import os
import uvicorn
import json
import logging
import re
import yaml
import sys
import tempfile
import time
from fastapi.staticfiles import StaticFiles
import uuid
import google.auth
import google.genai as genai

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import FastAPI, Depends, Request, APIRouter, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from starlette.config import Config
from starlette.responses import RedirectResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from urllib.parse import urlparse, urlunparse

from google.cloud import secretmanager, storage, bigquery, firestore, tasks_v2
from google.cloud.firestore_v1.base_query import FieldFilter
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.genai import types
from PIL import Image
import io
from vertexai.preview.vision_models import ImageGenerationModel
import vertexai

# Import the new video processing functions
from video_processing import process_video_from_gcs, check_quota
from config_manager import get_config, save_config, get_image_models
from prompts import IMAGE_IMITATION_PROMPT_PREFIX, IMAGE_IMITATION_PROMPT_SUFFIX, IMAGE_IMITATION_PROMPT_COMBINATION


# ==============================================================================
# NEW HELPER FOR BIGQUERY LOGGING
# ==============================================================================

def log_generation_to_bq(**kwargs):
    """
    Constructs a row and inserts it into the BigQuery history table.
    Ensures that logging does not crash the main application.
    """
    if not app_conf.get('ENABLE_BIGQUERY_LOGGING', False) or not bq_client:
        logger.warning("BigQuery client not configured or logging is disabled. Skipping logging.")
        return

    try:
        table_to_use = table_ref
        if "negative_prompt" in kwargs:
            table_to_use = bq_client.dataset(dataset_id).table("imagen_history")
            row_to_insert = {
                "user_email": kwargs.get("user_email"),
                "trigger_time": kwargs.get("trigger_time").isoformat(),
                "completion_time": kwargs.get("completion_time").isoformat(),
                "operation_duration": kwargs.get("operation_duration"),
                "prompt": kwargs.get("prompt"),
                "negative_prompt": kwargs.get("negative_prompt"),
                "model_used": kwargs.get("model_used"),
                "status": kwargs.get("status"),
                "error_message": str(kwargs.get("error_message", None)),
                "aspect_ratio": kwargs.get("aspect_ratio"),
                "output_image_gcs_path": kwargs.get("output_image_gcs_path"),
            }
        else:
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
                "resolution": kwargs.get("resolution"),
                "first_frame_gcs_uri": kwargs.get("first_frame_gcs_uri"),
                "last_frame_gcs_uri": kwargs.get("last_frame_gcs_uri"),
                "output_video_gcs_paths": json.dumps(kwargs.get("output_video_gcs_paths", [])),
            }

        # Remove None values so BQ doesn't complain about missing columns if not provided
        row_to_insert = {k: v for k, v in row_to_insert.items() if v is not None}

        errors = bq_client.insert_rows_json(table_to_use, [row_to_insert])
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

try:
    with open('./models.yaml', 'r') as models_file:
        models_conf = yaml.safe_load(models_file)
    logger.info("Successfully loaded models.yaml.")
except (FileNotFoundError, yaml.YAMLError) as e:
    logger.critical(f"Could not load or parse 'models.yaml'. Error: {e}")
    sys.exit(1)

image_models_conf = get_image_models()

# Overwrite with environment variables if they exist, for cloud deployments
app_conf['FRONTEND_URL'] = os.environ.get('FRONTEND_URL', app_conf.get('FRONTEND_URL'))
app_conf['REDIRECT_URI'] = os.environ.get('REDIRECT_URI', app_conf.get('REDIRECT_URI'))


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

generate_content_config = types.GenerateContentConfig(
    temperature = 0,
    top_p = 1,
    seed = 0,
    max_output_tokens = 65535,
    safety_settings = [types.SafetySetting(
      category="HARM_CATEGORY_HATE_SPEECH",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_HARASSMENT",
      threshold="OFF"
    )],
    thinking_config=types.ThinkingConfig(
      thinking_budget=0,
    ),
  )

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
    logger.info("Firestore client for prompt gallery initialized successfully.")
except Exception as e:
    logger.error(f"Could not initialize Firestore client for prompt gallery. Error: {e}", exc_info=True)
    db = None

try:
    config_db = firestore.Client(project=PROJECT, database=app_conf.get('CONFIG_DB'))
    logger.info("Firestore client for configuration initialized successfully.")
except Exception as e:
    logger.error(f"Could not initialize Firestore client for configuration. Error: {e}", exc_info=True)
    config_db = None

try:
    groups_db = firestore.Client(project=PROJECT, database=app_conf.get('GROUPS_DB'))
    logger.info("Firestore client for groups initialized successfully.")
except Exception as e:
    logger.error(f"Could not initialize Firestore client for groups. Error: {e}", exc_info=True)
    groups_db = None

try:
    shared_videos_db = firestore.Client(project=PROJECT, database=app_conf.get('SHARED_VIDEOS_DB'))
    logger.info("Firestore client for shared videos initialized successfully.")
except Exception as e:
    logger.error(f"Could not initialize Firestore client for shared videos. Error: {e}", exc_info=True)
    shared_videos_db = None

try:
    tasks_client = tasks_v2.CloudTasksClient()
    task_queue_path = tasks_client.queue_path(PROJECT, LOCATION, app_conf.get('UPSCALE_QUEUE_ID'))
    logger.info("Cloud Tasks client initialized successfully.")
except Exception as e:
    logger.error(f"Could not initialize Cloud Tasks client. Upscaling will be disabled. Error: {e}", exc_info=True)
    tasks_client = None
    task_queue_path = None

# Imagen Client
try:
    imagen_client = genai.Client(vertexai=True, project=PROJECT, location='us-central1') # imagen only applicable for us-central1
except Exception as e:
    raise HTTPException(status_code=500, detail=f"Failed to initialize client: {e}")

# ==============================================================================
# 2. VEO API CLIENT CLASS
# ==============================================================================

class VeoApiClient:
    def __init__(self, project_id: str, location: str, default_bucket_name: str):
        self.project_id = project_id
        self.location = location
        self.default_bucket_name = default_bucket_name
        self.default_model_id = app_conf.get('GEMINI_MODEL', "veo-2.0-generate-001")
        self.models_config = models_conf.get('models', [])

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
                access_token=self._credentials.token,
                service_account_email=self._credentials.service_account_email
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
            
            model_info = next((m for m in self.models_config if m['id'] == model_id), None)
            if not model_info:
                raise ValueError(f"Model '{model_id}' not found in configuration.")

            model_type = model_info.get('type')

            if final_frame_gcs_uri and model_type == "veo-2.0":
                # Only applicable for Veo2
                self.logger.info(f"Using final frame for generation: {final_frame_gcs_uri}")
                config.last_frame = types.Image(gcs_uri=final_frame_gcs_uri, mime_type="image/jpeg")

            if kwargs.get('enhance_prompt') is not None:
                config.enhance_prompt = kwargs['enhance_prompt']

            if model_type == "veo-3.0":
                if kwargs.get('generate_audio') is not None:
                    config.generate_audio = kwargs['generate_audio']
                if kwargs.get('resolution') is not None:
                    config.resolution = kwargs['resolution']
                self.logger.info(
                    f"Applying Veo 3.0 specifics: Audio={getattr(config, 'generate_audio', 'Default')}, Enhance={getattr(config, 'enhance_prompt', 'Default')}, Resolution={getattr(config, 'resolution', 'Default')}")

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
        redirect_uri = app_conf.get("REDIRECT_URI")
        if not redirect_uri:
            logger.error("REDIRECT_URI is not configured. Cannot initiate login.")
            raise HTTPException(status_code=500, detail="Server configuration error: REDIRECT_URI is missing.")
        return await oauth.google.authorize_redirect(request, redirect_uri)


    @app.get('/auth')
    async def auth(request: Request):
        frontend_url = app_conf.get("FRONTEND_URL")
        if not frontend_url:
            logger.error("FRONTEND_URL is not configured. Cannot complete auth.")
            raise HTTPException(status_code=500, detail="Server configuration error: FRONTEND_URL is missing.")
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
        # After logout, redirect to the root which is the login page.
        return RedirectResponse(url="/")


def get_user(request: Request) -> Optional[dict]:
    user = request.session.get('user')
    if user:
        app_admins = app_conf.get('APP_ADMINS', [])
        user_email = user.get('email')
        user['role'] = 'APP_ADMIN' if user_email in app_admins else 'USER'
    return user


# ==============================================================================
# 5. API ENDPOINTS
# ==============================================================================

@api_router.get("/user/me", tags=["User"])
def get_current_user_details(user: dict = Depends(get_user)):
    if not user:
        return JSONResponse({"authenticated": False}, status_code=401)

    cost_managers = app_conf.get('COST_MANAGERS', [])
    app_admins = app_conf.get('APP_ADMINS', [])
    user_email = user.get('email')
    is_cost_manager = user_email in cost_managers
    role = 'APP_ADMIN' if user_email in app_admins else 'USER'

    return JSONResponse({
        "authenticated": True,
        "name": user.get('name'),
        "email": user_email,
        "picture": user.get('picture'),
        "is_cost_manager": is_cost_manager,
        "role": role,
    })


@api_router.get("/config", tags=["Configuration"])
def get_app_config():
    """
    Returns public configuration details to the frontend.
    """
    return JSONResponse({
        "prompt_gallery_name": app_conf.get("PROMPT_GALLERY_COLLECTION", "prompts"),
        "enable_upscale": app_conf.get("ENABLE_UPSCALE", False)
    })


@api_router.get("/models", tags=["Configuration"])
def get_models():
    """
    Returns the available models from the configuration.
    """
    return JSONResponse(models_conf)


@api_router.get("/image-models", tags=["Configuration"])
def get_image_models_endpoint():
    """
    Returns the available image models from the configuration.
    """
    return JSONResponse(image_models_conf)


@api_router.get("/notification-banner", tags=["Configuration"])
def get_notification_banner():
    """
    Returns a list of notification banner messages if set in the config.
    """
    messages = app_conf.get("BANNER_MESSAGES", [])
    return JSONResponse({"messages": messages})


@api_router.get("/configurations", tags=["Configuration"])
def get_configurations(user: dict = Depends(get_user)):
    
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    return get_config(config_db)


@api_router.post("/configurations", tags=["Configuration"])
async def set_configurations(request: Request, user: dict = Depends(get_user)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    config = await request.json()
    save_config(config, config_db)
    return {"message": "Configuration saved successfully."}


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

    # Check quota
    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    quota_exceeded, message = check_quota(user_email, bq_client, get_config(config_db), app_conf)
    if quota_exceeded:
        raise HTTPException(status_code=429, detail=message)

    # --- Prepare logging data ---
    trigger_time = datetime.now(timezone.utc)
    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    model_used = body.get('model')
    prompt = body.get('prompt')
    requested_duration = body.get('duration')
    image_gcs_uri = body.get('image_gcs_uri')
    final_frame_gcs_uri = body.get('final_frame_gcs_uri')
    with_audio = body.get('generateAudio', False)
    resolution = body.get('resolution')

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
            extend_duration=body.get('extend_duration'),
            resolution=body.get('resolution')
        )

        # --- Log SUCCESS to BigQuery for each generated video ---
        completion_time = datetime.now(timezone.utc)
        
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
                resolution=resolution,
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
            resolution=resolution,
            first_frame_gcs_uri=image_gcs_uri,
            last_frame_gcs_uri=final_frame_gcs_uri,
            output_video_gcs_paths=[]
        )

        logger.error(f"Video generation failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video generation failed: {e}")


@api_router.post("/images/generate", tags=["Image Generation"])
async def generate_image(request: Request, user: dict = Depends(get_user)):
    if app_conf.get('ENABLE_OAUTH', False) and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    body = await request.json()

    if not body.get('prompt'):
        raise HTTPException(status_code=400, detail="Prompt is required.")

    # --- Prepare logging data ---
    trigger_time = datetime.now(timezone.utc)
    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    model_used = body.get('model')
    prompt = body.get('prompt')
    negative_prompt = body.get('negative_prompt')
    aspect_ratio = body.get('aspect_ratio')
    sample_count = body.get('sample_count')

    try:
        
        start_time = time.time()
        images = imagen_client.models.generate_images(
            model=model_used,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=sample_count,
                aspect_ratio=aspect_ratio,
                negative_prompt=negative_prompt,
                person_generation="allow_all",
                safety_filter_level="BLOCK_MEDIUM_AND_ABOVE",
                add_watermark=True
            )
        )
        op_duration = time.time() - start_time

        gcs_paths = []
        for generated_image in images.generated_images:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                generated_image.image._pil_image.save(temp_file.name)
                
                user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
                blob_name = f"image_outputs/{user_folder}/{uuid.uuid4().hex}.png"
                
                storage_client = storage.Client(project=PROJECT)
                bucket = storage_client.bucket(BUCKET_NAME)
                blob = bucket.blob(blob_name)
                blob.upload_from_filename(temp_file.name)
                
                gcs_paths.append(f"gs://{BUCKET_NAME}/{blob_name}")

        # --- Log SUCCESS to BigQuery for each generated image ---
        completion_time = datetime.now(timezone.utc)
        
        for path in gcs_paths:
            log_generation_to_bq(
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=completion_time,
                operation_duration=op_duration / len(gcs_paths) if gcs_paths else 0,
                prompt=prompt,
                negative_prompt=negative_prompt,
                model_used=model_used,
                status="SUCCESS",
                aspect_ratio=aspect_ratio,
                output_image_gcs_path=path
            )

        # --- Return response to frontend ---
        image_data = []
        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
        for uri in gcs_paths:
            signed_url = veo_client.generate_signed_gcs_url(uri)
            if signed_url:
                image_data.append({
                    "gcs_uri": uri,
                    "signed_url": signed_url
                })
        
        return JSONResponse({
            "message": "Image generation successful.",
            "images": image_data,
            "duration": op_duration
        }, status_code=200)

    except Exception as e:
        # --- Log FAILURE to BigQuery ---
        log_generation_to_bq(
            user_email=user_email,
            trigger_time=trigger_time,
            completion_time=datetime.now(timezone.utc),
            operation_duration=time.time() - trigger_time.timestamp(),
            prompt=prompt,
            negative_prompt=negative_prompt,
            model_used=model_used,
            status="FAILURE",
            error_message=str(e),
            aspect_ratio=aspect_ratio
        )

        logger.error(f"Image generation failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image generation failed: {e}")


@api_router.post("/images/imitate", tags=["Image Generation"])
async def imitate_image(
    user: dict = Depends(get_user),
    file: UploadFile = File(...),
    sub_prompt: str = Form(""),
    model: str = Form(...),
    sample_count: int = Form(1)
):
    if app_conf.get('ENABLE_OAUTH', False) and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Only images are allowed.")


    try:
        # 1. Upload image to GCS
        user_email = user.get('email', 'anonymous') if user else 'anonymous'
        user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
        
        storage_client = storage.Client(project=PROJECT)
        bucket = storage_client.bucket(BUCKET_NAME)
        
        file_extension = Path(file.filename).suffix
        blob_name = f"image_uploads/{user_folder}/{uuid.uuid4().hex}{file_extension}"
        blob = bucket.blob(blob_name)

        img_bytes = await file.read()
        blob.upload_from_string(img_bytes, content_type=file.content_type)
        
        gcs_uri = f"gs://{BUCKET_NAME}/{blob_name}"
        logger.info(f"User {user_email} uploaded image to {gcs_uri}")

        # 2. Describe the image with Gemini
        gemini_client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
        
        image_part = types.Part.from_uri(file_uri=gcs_uri, mime_type=file.content_type)

        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_text(text=IMAGE_IMITATION_PROMPT_PREFIX),
                image_part,
                types.Part.from_text(text=IMAGE_IMITATION_PROMPT_SUFFIX)
            ],
            config=generate_content_config
        )
        image_description = response.text

        # 2. Combine with sub-prompt
        combined_prompt_template = IMAGE_IMITATION_PROMPT_COMBINATION.format(image_description_json=image_description, cust_input_text=sub_prompt)

        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_text(text=combined_prompt_template),
            ],
            config=generate_content_config
        )

        combined_prompt = response.text

        # 3. Generate a new image
        start_time = time.time()
        images = imagen_client.models.generate_images(
            model=model,
            prompt=combined_prompt,
            config=types.GenerateImagesConfig(
                number_of_images=sample_count,
                person_generation="allow_all",
                safety_filter_level="BLOCK_MEDIUM_AND_ABOVE",
                add_watermark=True
            )
        )
        op_duration = time.time() - start_time

        gcs_paths = []
        for generated_image in images.generated_images:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                generated_image.image._pil_image.save(temp_file.name)
                
                user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
                blob_name = f"image_outputs/{user_folder}/{uuid.uuid4().hex}.png"
                
                storage_client = storage.Client(project=PROJECT)
                bucket = storage_client.bucket(BUCKET_NAME)
                blob = bucket.blob(blob_name)
                blob.upload_from_filename(temp_file.name)
                
                gcs_paths.append(f"gs://{BUCKET_NAME}/{blob_name}")

        # 4. Log and return
        completion_time = datetime.now(timezone.utc)
        
        for path in gcs_paths:
            log_generation_to_bq(
                user_email=user_email,
                trigger_time=datetime.now(timezone.utc),
                completion_time=completion_time,
                operation_duration=op_duration / len(gcs_paths) if gcs_paths else 0,
                prompt=combined_prompt,
                negative_prompt=None,
                model_used=model,
                status="SUCCESS",
                output_image_gcs_path=path
            )

        image_data = []
        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
        for uri in gcs_paths:
            signed_url = veo_client.generate_signed_gcs_url(uri)
            if signed_url:
                image_data.append({
                    "gcs_uri": uri,
                    "signed_url": signed_url
                })
        
        return JSONResponse({
            "message": "Image imitation successful.",
            "images": image_data,
            "duration": op_duration,
            "revised_prompt": combined_prompt
        }, status_code=200)

    except Exception as e:
        logger.error(f"Image imitation failed for user {user.get('email', 'anonymous')}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image imitation failed: {e}")


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
def get_prompts_from_gallery(tags: Optional[str] = None, page: int = 1, page_size: int = 10):
    if not db:
        raise HTTPException(status_code=503, detail="Firestore is not configured")

    prompts_ref = db.collection(prompt_gallery_collection_id)
    
    tag_list = [tag.strip() for tag in tags.split(',')] if tags else []
    
    # Get total count for pagination
    count_query = prompts_ref
    total_rows = 0
    if tag_list:
        for tag in tag_list:
            count_query = count_query.where(filter=FieldFilter("keywords", "array_contains", tag))
            total_rows += len(list(count_query.stream()))
        
    total_rows = len(list(count_query.stream()))

    # Get paginated results
    query = prompts_ref.order_by("created_at", direction=firestore.Query.DESCENDING)
    if tag_list:
        for tag in tag_list:
            query = query.where(filter=FieldFilter("keywords", "array_contains", tag))
            
    query = query.limit(page_size).offset((page - 1) * page_size)
    
    prompts = []
    for doc in query.stream():
        prompt_data = doc.to_dict()
        prompt_data["id"] = doc.id
        if 'created_at' in prompt_data and hasattr(prompt_data['created_at'], 'isoformat'):
            prompt_data['created_at'] = prompt_data['created_at'].isoformat()
        prompts.append(prompt_data)

    return JSONResponse({"rows": prompts, "total": total_rows})


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


@api_router.get("/images/history", tags=["Image Generation"])
def get_image_history(
    request: Request,
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
    model: Optional[str] = None,
    page: int = 1,
    page_size: int = 10
):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not app_conf.get('ENABLE_BIGQUERY_LOGGING', False) or not bq_client:
        logger.warning(f"Attempted to access image history for {user.get('email')} but BigQuery is disabled.")
        return JSONResponse({"rows": [], "total": 0}, status_code=200)

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

    count_query = f"""
        SELECT COUNT(*) as total
        FROM `{PROJECT}.{dataset_id}.imagen_history`
        WHERE {" AND ".join(where_clauses)}
    """
    count_job_config = bigquery.QueryJobConfig(query_parameters=query_params)
    count_query_job = bq_client.query(count_query, job_config=count_job_config)
    total_rows = list(count_query_job.result())[0].total

    query = f"""
        SELECT
            user_email,
            CAST(trigger_time AS STRING) AS trigger_time,
            CAST(completion_time AS STRING) AS completion_time,
            prompt,
            model_used,
            output_image_gcs_path,
            status
        FROM
            `{PROJECT}.{dataset_id}.imagen_history`
        WHERE {" AND ".join(where_clauses)} ORDER BY trigger_time DESC
        LIMIT {page_size} OFFSET {(page - 1) * page_size}
    """
    
    job_config = bigquery.QueryJobConfig(query_parameters=query_params)

    try:
        query_job = bq_client.query(query, job_config=job_config)
        rows = [dict(row) for row in query_job.result()]

        veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
        for row in rows:
            gcs_path = row.get("output_image_gcs_path")
            if gcs_path:
                row["signed_url"] = veo_client.generate_signed_gcs_url(gcs_path)

        return JSONResponse({"rows": rows, "total": total_rows})

    except Exception as e:
        logger.error(f"Error querying image history for user {user_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve image history.")


@api_router.get("/videos/history", tags=["Video Generation"])
def get_user_history(
    request: Request,
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
    model: Optional[str] = None,
    is_edited: Optional[bool] = False,
    page: int = 1,
    page_size: int = 10
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

    count_query = f"""
        SELECT COUNT(*) as total
        FROM `{PROJECT}.{dataset_id}.{table_id}`
        WHERE {" AND ".join(where_clauses)}
    """
    count_job_config = bigquery.QueryJobConfig(query_parameters=query_params)
    count_query_job = bq_client.query(count_query, job_config=count_job_config)
    total_rows = list(count_query_job.result())[0].total

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
            last_frame_gcs_uri,
            resolution
        FROM
            `{PROJECT}.{dataset_id}.{table_id}`
        WHERE {" AND ".join(where_clauses)} ORDER BY trigger_time DESC
        LIMIT {page_size} OFFSET {(page - 1) * page_size}
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

        return JSONResponse({"rows": rows, "total": total_rows})

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


@api_router.post("/videos/upscale", tags=["Video Editing"])
async def upscale_video_endpoint(request: Request, user: dict = Depends(get_user)):
    if not app_conf.get("ENABLE_UPSCALE", False):
        raise HTTPException(status_code=404, detail="Not Found")
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not tasks_client or not task_queue_path:
        raise HTTPException(status_code=503, detail="Upscaling service is not available.")

    body = await request.json()
    gcs_uri = body.get('gcs_uri')
    resolution = body.get('resolution')

    if not gcs_uri or not resolution:
        raise HTTPException(status_code=400, detail="gcs_uri and resolution are required.")

    job_id = str(uuid.uuid4())
    user_email = user.get('email', 'anonymous')

    # Create a record in Firestore for the job
    job_ref = db.collection(app_conf.get('UPSCALE_JOBS_COLLECTION')).document(job_id)
    job_ref.set({
        'user_email': user_email,
        'gcs_uri': gcs_uri,
        'resolution': resolution,
        'status': 'queued',
        'created_at': firestore.SERVER_TIMESTAMP,
    })

    # Create a task in Cloud Tasks
    task = {
        'http_request': {
            'http_method': tasks_v2.HttpMethod.POST,
            'url': app_conf.get('UPSCALE_WORKER_URL'),
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'job_id': job_id,
                'gcs_uri': gcs_uri,
                'resolution': resolution,
            }).encode(),
        }
    }
    tasks_client.create_task(parent=task_queue_path, task=task)

    return JSONResponse({"message": "Upscale job created successfully.", "job_id": job_id}, status_code=202)


@api_router.get("/videos/upscale/status/{job_id}", tags=["Video Editing"])
def get_upscale_job_status(job_id: str, user: dict = Depends(get_user)):
    if not app_conf.get("ENABLE_UPSCALE", False):
        raise HTTPException(status_code=404, detail="Not Found")
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    job_ref = db.collection(app_conf.get('UPSCALE_JOBS_COLLECTION')).document(job_id)
    job = job_ref.get()

    if not job.exists:
        raise HTTPException(status_code=404, detail="Job not found")

    return JSONResponse(job.to_dict())


@api_router.get("/videos/upscale/jobs", tags=["Video Editing"])
def get_upscale_jobs(user: dict = Depends(get_user)):
    if not app_conf.get("ENABLE_UPSCALE", False):
        raise HTTPException(status_code=404, detail="Not Found")
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_email = user.get('email')
    # jobs_ref = db.collection(app_conf.get('UPSCALE_JOBS_COLLECTION')).where('user_email', '==', user_email).order_by('created_at', direction=firestore.Query.DESCENDING)
    jobs_ref = db.collection(app_conf.get('UPSCALE_JOBS_COLLECTION')).where(filter=FieldFilter('user_email', '==', user_email)).order_by('created_at', direction=firestore.Query.DESCENDING)

    jobs = []
    veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
    for doc in jobs_ref.stream():
        job_data = doc.to_dict()
        job_data["id"] = doc.id
        if 'created_at' in job_data and hasattr(job_data['created_at'], 'isoformat'):
            job_data['created_at'] = job_data['created_at'].isoformat()
        if job_data.get('status') == 'completed' and job_data.get('upscaled_gcs_uri'):
            job_data['signed_url'] = veo_client.generate_signed_gcs_url(job_data['upscaled_gcs_uri'])
        jobs.append(job_data)

    return JSONResponse(jobs)


@api_router.post("/groups", tags=["Groups"])
async def create_group(request: Request, user: dict = Depends(get_user)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    body = await request.json()
    group_name = body.get("name")
    members = body.get("members", [])

    if not group_name:
        raise HTTPException(status_code=400, detail="Group name is required.")

    doc_ref = groups_db.collection('groups').document()
    doc_ref.set({
        "name": group_name,
        "members": members,
        "created_by": user.get("email"),
        "created_at": firestore.SERVER_TIMESTAMP
    })
    return JSONResponse({"message": "Group created successfully", "id": doc_ref.id}, status_code=201)


@api_router.get("/groups", tags=["Groups"])
def get_groups(user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    if user.get('role') == 'APP_ADMIN':
        groups_ref = groups_db.collection('groups')
    else:
        user_email = user.get('email')
        groups_ref = groups_db.collection('groups').where(filter=FieldFilter('members', 'array_contains', user_email))
    
    groups = []
    for doc in groups_ref.stream():
        group_data = doc.to_dict()
        group_data["id"] = doc.id
        if 'created_at' in group_data and hasattr(group_data['created_at'], 'isoformat'):
            group_data['created_at'] = group_data['created_at'].isoformat()
        groups.append(group_data)

    return JSONResponse(groups)


@api_router.post("/groups/{group_id}/members", tags=["Groups"])
async def add_group_member(group_id: str, request: Request, user: dict = Depends(get_user)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    body = await request.json()
    member_email = body.get("email")

    if not member_email:
        raise HTTPException(status_code=400, detail="Member email is required.")

    doc_ref = groups_db.collection('groups').document(group_id)
    doc_ref.update({
        "members": firestore.ArrayUnion([member_email])
    })
    return JSONResponse({"message": "Member added successfully."})


@api_router.delete("/groups/{group_id}/members/{member_email}", tags=["Groups"])
def remove_group_member(group_id: str, member_email: str, user: dict = Depends(get_user)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    doc_ref = groups_db.collection('groups').document(group_id)
    doc_ref.update({
        "members": firestore.ArrayRemove([member_email])
    })
    return JSONResponse({"message": "Member removed successfully."})


@api_router.post("/groups/{group_id}/members/bulk", tags=["Groups"])
async def bulk_add_group_members(group_id: str, request: Request, user: dict = Depends(get_user)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    body = await request.json()
    emails = body.get("emails", [])

    if not emails:
        raise HTTPException(status_code=400, detail="Emails are required.")

    doc_ref = groups_db.collection('groups').document(group_id)
    doc_ref.update({
        "members": firestore.ArrayUnion(emails)
    })
    return JSONResponse({"message": "Members added successfully."})


@api_router.delete("/groups/{group_id}/members/bulk", tags=["Groups"])
async def bulk_remove_group_members(group_id: str, request: Request, user: dict = Depends(get_user)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    body = await request.json()
    emails = body.get("emails", [])

    if not emails:
        raise HTTPException(status_code=400, detail="Emails are required.")

    doc_ref = groups_db.collection('groups').document(group_id)
    doc_ref.update({
        "members": firestore.ArrayRemove(emails)
    })
    return JSONResponse({"message": "Members removed successfully."})


@api_router.post("/groups/import", tags=["Groups"])
async def import_groups(request: Request, user: dict = Depends(get_user)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    body = await request.json()
    import_data = body.get("data", [])

    if not import_data:
        raise HTTPException(status_code=400, detail="No data provided for import.")

    try:
        for group_data in import_data:
            group_name = group_data.get("groupName")
            members = group_data.get("members", [])
            
            if not group_name or not members:
                continue

            # Check if group exists
            query = groups_db.collection('groups').where(filter=FieldFilter("name", "==", group_name)).limit(1)
            existing_groups = list(query.stream())

            if existing_groups:
                # Group exists, update members
                group_ref = existing_groups[0].reference
                group_ref.update({"members": firestore.ArrayUnion(members)})
            else:
                # Group does not exist, create it
                doc_ref = groups_db.collection('groups').document()
                doc_ref.set({
                    "name": group_name,
                    "members": members,
                    "created_by": user.get("email"),
                    "created_at": firestore.SERVER_TIMESTAMP
                })
        
        return JSONResponse({"message": "Groups imported successfully."})
    except Exception as e:
        logger.error(f"Group import failed. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Group import failed: {e}")


@api_router.post("/videos/share", tags=["Sharing"])
async def share_video(request: Request, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not shared_videos_db:
        raise HTTPException(status_code=503, detail="Shared videos database is not configured")

    body = await request.json()
    video_data = body.get("video")
    group_id = body.get("group_id")

    if not video_data or not group_id:
        raise HTTPException(status_code=400, detail="Video data and group_id are required.")

    # Extract the GCS URI from the potentially nested structure
    gcs_uri = video_data.get('gcs_uri') or video_data.get('output_image_gcs_path')
    if not gcs_uri:
        gcs_paths_str = video_data.get("output_video_gcs_paths", "[]")
        try:
            gcs_paths = json.loads(gcs_paths_str)
            if gcs_paths:
                gcs_uri = gcs_paths[0]
        except (json.JSONDecodeError, TypeError):
            pass
    
    if not gcs_uri:
        raise HTTPException(status_code=400, detail="Could not determine a valid GCS URI from the video data.")

    doc_ref = shared_videos_db.collection(app_conf['SHARED_VIDEOS_COLLECTION']).document()
    
    # Create a new document with all the relevant video details
    shared_video_payload = {
        "gcs_uri": gcs_uri,
        "shared_with_group_id": group_id,
        "shared_by_user_email": user.get("email"),
        "shared_at": firestore.SERVER_TIMESTAMP,
        "prompt": video_data.get("prompt"),
        "user_email": video_data.get("user_email"), # Original generator
        "trigger_time": video_data.get("trigger_time"),
        "completion_time": video_data.get("completion_time"),
        "operation_duration": video_data.get("operation_duration"),
        "status": video_data.get("status"),
        "model_used": video_data.get("model_used"),
        "resolution": video_data.get("resolution"),
    }
    
    # Filter out any None values to keep the Firestore document clean
    shared_video_payload = {k: v for k, v in shared_video_payload.items() if v is not None}

    doc_ref.set(shared_video_payload)
    
    return JSONResponse({"message": "Shared successfully", "id": doc_ref.id}, status_code=201)


@api_router.post("/images/share", tags=["Sharing"])
async def share_image(request: Request, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not shared_videos_db:
        raise HTTPException(status_code=503, detail="Shared items database is not configured")

    body = await request.json()
    item_data = body.get("item")
    group_id = body.get("group_id")

    if not item_data or not group_id:
        raise HTTPException(status_code=400, detail="Item data and group_id are required.")

    gcs_uri = item_data.get('gcs_uri')

    if not gcs_uri:
        raise HTTPException(status_code=400, detail="Could not determine a valid GCS URI from the item data.")

    doc_ref = shared_videos_db.collection(app_conf['SHARED_VIDEOS_COLLECTION']).document()
    
    shared_item_payload = {
        "gcs_uri": gcs_uri,
        "shared_with_group_id": group_id,
        "shared_by_user_email": user.get("email"),
        "shared_at": firestore.SERVER_TIMESTAMP,
        "prompt": item_data.get("prompt"),
        "user_email": item_data.get("user_email"),
        "trigger_time": item_data.get("trigger_time"),
        "completion_time": item_data.get("completion_time"),
        "operation_duration": item_data.get("operation_duration"),
        "status": item_data.get("status"),
        "model_used": item_data.get("model_used"),
        "type": item_data.get("type"),
    }
    
    shared_item_payload = {k: v for k, v in shared_item_payload.items() if v is not None}

    doc_ref.set(shared_item_payload)
    
    return JSONResponse({"message": "Shared successfully", "id": doc_ref.id}, status_code=201)


@api_router.get("/groups/{group_id}/items", tags=["Sharing"])
def get_shared_items(group_id: str, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not groups_db or not shared_videos_db:
        raise HTTPException(status_code=503, detail="Database services are not configured")

    # Check if user is a member of the group
    group_ref = groups_db.collection('groups').document(group_id)
    group = group_ref.get()
    if not group.exists or user.get('email') not in group.to_dict().get('members', []):
        raise HTTPException(status_code=403, detail="Permission denied")

    items_ref = shared_videos_db.collection(app_conf['SHARED_VIDEOS_COLLECTION']).where(filter=FieldFilter('shared_with_group_id', '==', group_id)).order_by('shared_at', direction=firestore.Query.DESCENDING)
    
    items = []
    veo_client = VeoApiClient(PROJECT, LOCATION, BUCKET_NAME)
    
    for doc in items_ref.stream():
        item_data = doc.to_dict()
        item_data["id"] = doc.id
        
        if 'shared_at' in item_data and hasattr(item_data['shared_at'], 'isoformat'):
            item_data['shared_at'] = item_data['shared_at'].isoformat()
        
        # 'gcs_uri' for image, video_gcs_uri for video
        gcs_uri = item_data.get('gcs_uri') or item_data.get('video_gcs_uri')
        if gcs_uri:
            item_data['signed_url'] = veo_client.generate_signed_gcs_url(gcs_uri)
        
        items.append(item_data)

    return JSONResponse(items)


@api_router.delete("/shared-items/{shared_item_id}", tags=["Sharing"])
def delete_shared_item(shared_item_id: str, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not shared_videos_db:
        raise HTTPException(status_code=503, detail="Shared items database is not configured")

    doc_ref = shared_videos_db.collection(app_conf['SHARED_VIDEOS_COLLECTION']).document(shared_item_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Shared item not found")

    if doc.to_dict().get("shared_by_user_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only delete items you have shared.")

    doc_ref.delete()
    return JSONResponse({"message": "Shared item deleted successfully"})


@api_router.get("/analytics/consumption", tags=["Analytics"])
def get_consumption_analytics(
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    Provides aggregated consumption data for both video and image generation.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    cost_managers = app_conf.get('COST_MANAGERS', [])
    if user.get('email') not in cost_managers:
        raise HTTPException(status_code=403, detail="You do not have permission to view analytics.")

    if not app_conf.get('ENABLE_BIGQUERY_LOGGING', False) or not bq_client:
        raise HTTPException(status_code=501, detail="Analytics are disabled (BigQuery not configured).")

    # --- Helper functions for cost calculation ---
    def calculate_video_cost(model_used: str, video_duration: float, with_audio: Optional[bool]) -> float:
        if not model_used or not video_duration: return 0.0
        model_info = next((m for m in models_conf.get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        cost_per_second = pricing.get('video_with_audio') if with_audio else pricing.get('video_without_audio', 0.0)
        return round(video_duration * cost_per_second, 4)

    def calculate_image_cost(model_used: str) -> float:
        if not model_used: return 0.0
        model_info = next((m for m in image_models_conf.get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        return round(pricing.get('per_image', 0.0), 4)

    try:
        # --- Prepare queries and parameters ---
        query_params = []
        video_where_clauses = ["status = 'SUCCESS'", "video_duration > 0"]
        image_where_clauses = ["status = 'SUCCESS'"]

        if start_date:
            video_where_clauses.append("trigger_time >= @start_date")
            image_where_clauses.append("trigger_time >= @start_date")
            query_params.append(bigquery.ScalarQueryParameter("start_date", "TIMESTAMP", start_date))
        if end_date:
            end_date_inclusive = (datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)).isoformat()
            video_where_clauses.append("trigger_time < @end_date")
            image_where_clauses.append("trigger_time < @end_date")
            query_params.append(bigquery.ScalarQueryParameter("end_date", "TIMESTAMP", end_date_inclusive))

        video_query = f"""
            SELECT trigger_time, user_email, model_used, video_duration, with_audio
            FROM `{PROJECT}.{dataset_id}.{table_id}`
            WHERE {" AND ".join(video_where_clauses)}
        """
        image_query = f"""
            SELECT trigger_time, user_email, model_used
            FROM `{PROJECT}.{dataset_id}.imagen_history`
            WHERE {" AND ".join(image_where_clauses)}
        """
        job_config = bigquery.QueryJobConfig(query_parameters=query_params)

        # --- Execute queries and process data ---
        video_rows = bq_client.query(video_query, job_config=job_config).result()
        image_rows = bq_client.query(image_query, job_config=job_config).result()

        daily_costs = {}
        user_costs = {}

        # Process video costs
        for row in video_rows:
            cost = calculate_video_cost(row.model_used, row.video_duration, row.with_audio)
            if cost > 0:
                consumption_date = row.trigger_time.strftime('%Y-%m-%d')
                date_entry = daily_costs.setdefault(consumption_date, {'video': 0, 'image': 0})
                date_entry['video'] += cost

                user_entry = user_costs.setdefault(row.user_email, {'video': 0, 'image': 0})
                user_entry['video'] += cost
        
        # Process image costs
        for row in image_rows:
            cost = calculate_image_cost(row.model_used)
            if cost > 0:
                consumption_date = row.trigger_time.strftime('%Y-%m-%d')
                date_entry = daily_costs.setdefault(consumption_date, {'video': 0, 'image': 0})
                date_entry['image'] += cost

                user_entry = user_costs.setdefault(row.user_email, {'video': 0, 'image': 0})
                user_entry['image'] += cost

        # --- Format data for response ---
        total_video_cost = sum(user['video'] for user in user_costs.values())
        total_image_cost = sum(user['image'] for user in user_costs.values())
        total_cost = total_video_cost + total_image_cost

        daily_consumption_chart_data = [
            {
                "consumption_date": date, 
                "video_cost": round(costs['video'], 2),
                "image_cost": round(costs['image'], 2),
                "total_cost": round(costs['video'] + costs['image'], 2)
            }
            for date, costs in sorted(daily_costs.items())
        ]
        
        top_users_chart_data = sorted(
            [
                {
                    "user_email": email, 
                    "video_cost": round(costs['video'], 2),
                    "image_cost": round(costs['image'], 2),
                    "total_cost": round(costs['video'] + costs['image'], 2)
                } 
                for email, costs in user_costs.items()
            ],
            key=lambda x: x["total_cost"],
            reverse=True
        )[:10]

        # --- Model Usage Distribution ---
        video_dist_query = f"SELECT model_used, with_audio, COUNT(*) as generation_count FROM `{PROJECT}.{dataset_id}.{table_id}` WHERE {' AND '.join(video_where_clauses)} AND model_used LIKE 'veo-%' GROUP BY model_used, with_audio"
        image_dist_query = f"SELECT model_used, COUNT(*) as generation_count FROM `{PROJECT}.{dataset_id}.imagen_history` WHERE {' AND '.join(image_where_clauses)} GROUP BY model_used"
        
        video_dist_results = [dict(row) for row in bq_client.query(video_dist_query, job_config=job_config).result()]
        image_dist_results = [dict(row) for row in bq_client.query(image_dist_query, job_config=job_config).result()]

        return JSONResponse({
            "summary": {
                "total_cost": round(total_cost, 2),
                "total_video_cost": round(total_video_cost, 2),
                "total_image_cost": round(total_image_cost, 2),
            },
            "daily_consumption": daily_consumption_chart_data,
            "top_users": top_users_chart_data,
            "model_distribution": {
                "video": video_dist_results,
                "image": image_dist_results
            }
        })

    except Exception as e:
        logger.error(f"Failed to execute analytics query. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve analytics data.")


# ==============================================================================
# 6. APP ROUTING AND STARTUP
# ==============================================================================
@api_router.post("/generate-prompt-from-images", tags=["Prompt Generation"])
async def generate_prompt_from_images(
    character_image: Optional[UploadFile] = File(None),
    background_image: Optional[UploadFile] = File(None),
    prop_image: Optional[UploadFile] = File(None)
):
    if not character_image and not background_image and not prop_image:
        raise HTTPException(status_code=400, detail="At least one image must be provided.")

    try:
        client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
        
        parts = []
        prompt_text = "Describe a scene based on the following images: "
        
        if character_image:
            prompt_text += "a character, "
            img_bytes = await character_image.read()
            parts.append(types.Part.from_bytes(data=img_bytes, mime_type=character_image.content_type))
        
        if background_image:
            prompt_text += "a background, "
            img_bytes = await background_image.read()
            parts.append(types.Part.from_bytes(data=img_bytes, mime_type=background_image.content_type))

        if prop_image:
            prompt_text += "a prop. "
            img_bytes = await prop_image.read()
            parts.append(types.Part.from_bytes(data=img_bytes, mime_type=prop_image.content_type))

        # Insert the descriptive text at the beginning of the parts list
        parts.insert(0, types.Part.from_text(text=prompt_text.strip().rstrip(',')))

        model = "gemini-2.5-pro"
        contents = [types.Content(role="user", parts=parts)]

        generate_config = types.GenerateContentConfig(
            temperature=1,
            top_p=1,
            seed=0,
            max_output_tokens=65535,
            safety_settings=[
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF")
            ],
            thinking_config=types.ThinkingConfig(thinking_budget=-1),
        )

        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=generate_config,
        )

        return JSONResponse({"prompt": response.text})

    except Exception as e:
        logger.error(f"Prompt generation from images failed. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Prompt generation failed: {e}")


@api_router.post("/translate", tags=["Translation"])
async def translate_text_endpoint(request: Request, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    body = await request.json()
    text = body.get("text")
    target_language = body.get("target_language")

    if not text or not target_language:
        raise HTTPException(status_code=400, detail="Text and target_language are required.")

    try:
        genai_client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
        response = genai_client.models.generate_content(
            model = "gemini-2.5-flash",
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(text=f"Translate the following text to {target_language}: {text}")
                    ]
                )
            ],
            config=generate_content_config
        )
        return JSONResponse({"translated_text": response.text})
    except Exception as e:
        logger.error(f"Translation failed. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")


app.include_router(api_router)


# ==============================================================================
# 7. STATIC FILE SERVING (FRONTEND)
# ==============================================================================
# This must be placed at the end, after all other API and auth routes have been defined.
# It acts as a catch-all to serve the React application.
app.mount("/static", StaticFiles(directory="static/static"), name="static_assets")
app.mount("/", StaticFiles(directory="static", html=True), name="app")


if __name__ == '__main__':
    port = int(os.getenv("PORT", "7860"))
    logger.info(f"Starting Uvicorn server on http://0.0.0.0:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
