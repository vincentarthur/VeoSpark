import time
import uuid
import re
from pathlib import Path
import tempfile
from typing import Dict, Any, Optional, List, Tuple
from config import settings
from dependencies import get_genai_client, get_imagen_client
from config_manager import get_models_config
from google.cloud import storage
import google.genai as genai
from google.genai import types
import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest
from datetime import datetime, timedelta, timezone
import logging
from google.cloud import bigquery, firestore
from prompts import IMAGE_IMITATION_PROMPT_PREFIX, IMAGE_IMITATION_PROMPT_SUFFIX, IMAGE_IMITATION_PROMPT_COMBINATION

logger = logging.getLogger(__name__)

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

def add_asset_to_creative_project(project_id: str, asset_data: Dict[str, Any], user_info: Dict[str, Any]):
    """
    Adds an asset to a creative project's subcollection in Firestore.
    """
    if not settings.CREATIVE_PROJECTS_DB:
        logger.error("Creative projects database is not configured. Skipping asset addition.")
        return

    if not project_id:
        logger.info("No creative_project_id provided. Skipping asset addition to project.")
        return

    try:
        creative_projects_db = firestore.Client(project=settings.PROJECT_ID, database=settings.CREATIVE_PROJECTS_DB)
        project_ref = creative_projects_db.collection('projects').document(project_id)
        project_doc = project_ref.get()

        if not project_doc.exists:
            logger.error(f"Creative project with ID '{project_id}' not found.")
            return

        # Optional: Check if user is a member of the project
        project_members = project_doc.to_dict().get('members', [])
        user_email = user_info.get('email')
        if user_email not in project_members and user_info.get('role') != 'APP_ADMIN':
            logger.warning(f"User '{user_email}' is not a member of project '{project_id}'. Skipping asset addition.")
            return

        asset_ref = project_ref.collection('assets').document()
        asset_payload = {
            "added_by": user_email,
            "added_at": firestore.SERVER_TIMESTAMP,
            **asset_data
        }
        asset_ref.set(asset_payload)
        logger.info(f"Successfully added asset to creative project '{project_id}'. Asset ID: {asset_ref.id}")

    except Exception as e:
        logger.error(f"Failed to add asset to creative project '{project_id}'. Error: {e}", exc_info=True)

def log_generation_to_bq(table_name: str, **kwargs):
    if not settings.ENABLE_BIGQUERY_LOGGING:
        return

    bq_client = bigquery.Client(project=settings.PROJECT_ID)
    table_id = f"{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{table_name}"
    
    # Remove None values and serialize datetimes
    serialized_kwargs = {}
    for k, v in kwargs.items():
        if v is None:
            continue
        if isinstance(v, datetime):
            serialized_kwargs[k] = v.isoformat()
        else:
            serialized_kwargs[k] = v
    
    errors = bq_client.insert_rows_json(table_id, [serialized_kwargs])
    if errors:
        logging.error(f"Encountered errors while inserting rows: {errors}")

class VeoApiClient:
    def __init__(self, project_id: str, location: str, default_bucket_name: str):
        self.project_id = project_id
        self.location = location
        self.default_bucket_name = default_bucket_name
        self.default_model_id = settings.GEMINI_MODEL
        self.models_config = get_models_config().get('models', [])

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

class GenerationService:
    def __init__(self, genai_client, imagen_client):
        self.genai_client = genai_client
        self.imagen_client = imagen_client

    def on_video_generation_success(self, result: Dict[str, Any], **kwargs):
        """Callback for successful video generation."""
        logger.info("Video generation succeeded. Processing results.")
        user_info = kwargs.get('user_info')
        body = kwargs.get('body')
        prompt = kwargs.get('prompt')
        trigger_time = kwargs.get('trigger_time')

        video_data = result.get("videos", [])
        op_duration = result.get("duration", 0)
        revised_prompt = result.get("revisedPrompt")
        
        completion_time = datetime.now(timezone.utc)
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'
        
        for video in video_data:
            path = video['gcs_uri']
            log_generation_to_bq(
                table_name=settings.HISTORY_TABLE,
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=completion_time,
                operation_duration=op_duration / len(video_data) if video_data else 0,
                prompt=prompt,
                model_used=body.get('model'),
                status="SUCCESS",
                error_message=None,
                video_duration=body.get('duration'),
                with_audio=body.get('generateAudio', False),
                resolution=body.get('resolution'),
                first_frame_gcs_uri=body.get('image_gcs_uri'),
                last_frame_gcs_uri=body.get('final_frame_gcs_uri'),
                output_video_gcs_paths=path,
                creative_project_id=body.get('creative_project_id')
            )

        creative_project_id = body.get('creative_project_id')
        if creative_project_id and video_data:
            for video in video_data:
                path = video['gcs_uri']
                asset_data = {
                    "type": "video",
                    "gcs_uri": path,
                    "prompt": prompt,
                    "revised_prompt": revised_prompt,
                    "model_used": body.get('model'),
                    "video_duration": body.get('duration'),
                    "with_audio": body.get('generateAudio', False),
                    "resolution": body.get('resolution'),
                    "status": "SUCCESS",
                    "trigger_time": trigger_time.isoformat(),
                    "completion_time": completion_time.isoformat(),
                }
                add_asset_to_creative_project(creative_project_id, asset_data, user_info)

    def on_image_generation_success(self, result: Dict[str, Any], **kwargs):
        """Callback for successful image generation."""
        logger.info("Image generation succeeded. Processing results.")
        user_info = kwargs.get('user_info')
        body = kwargs.get('body')
        prompt = body.get('prompt')
        trigger_time = kwargs.get('trigger_time')

        image_data = result.get("images", [])
        op_duration = result.get("duration", 0)
        
        completion_time = datetime.now(timezone.utc)
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'
        
        for img in image_data:
            path = img['gcs_uri']
            log_generation_to_bq(
                table_name=settings.IMAGEN_HISTORY_TABLE,
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=completion_time,
                operation_duration=op_duration / len(image_data) if image_data else 0,
                prompt=prompt,
                negative_prompt=body.get('negative_prompt'),
                model_used=body.get('model'),
                status="SUCCESS",
                aspect_ratio=body.get('aspect_ratio'),
                output_image_gcs_path=path,
                resolution=body.get('image_size'),
                creative_project_id=body.get('creative_project_id')
            )

        creative_project_id = body.get('creative_project_id')
        if creative_project_id and image_data:
            for img in image_data:
                path = img['gcs_uri']
                asset_data = {
                    "type": "image",
                    "gcs_uri": path,
                    "prompt": prompt,
                    "negative_prompt": body.get('negative_prompt'),
                    "model_used": body.get('model'),
                    "aspect_ratio": body.get('aspect_ratio'),
                    "resolution": body.get('image_size'),
                    "status": "SUCCESS",
                    "trigger_time": trigger_time.isoformat(),
                    "completion_time": completion_time.isoformat(),
                }
                add_asset_to_creative_project(creative_project_id, asset_data, user_info)

    def on_image_imitation_success(self, result: Dict[str, Any], **kwargs):
        """Callback for successful image imitation."""
        logger.info("Image imitation succeeded. Processing results.")
        user_info = kwargs.get('user_info')
        creative_project_id = kwargs.get('creative_project_id')
        trigger_time = kwargs.get('trigger_time')

        image_data = result.get("images", [])
        op_duration = result.get("duration", 0)
        revised_prompt = result.get("revised_prompt")
        model = result.get("model")
        image_size = result.get("resolution")
        
        completion_time = datetime.now(timezone.utc)
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'

        for img in image_data:
            path = img['gcs_uri']
            log_generation_to_bq(
                table_name=settings.IMAGEN_HISTORY_TABLE,
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=completion_time,
                operation_duration=op_duration / len(image_data) if image_data else 0,
                prompt=revised_prompt,
                negative_prompt=None,
                model_used=model,
                status="SUCCESS",
                output_image_gcs_path=path,
                resolution=image_size,
                creative_project_id=creative_project_id
            )

        if creative_project_id and image_data:
            for img in image_data:
                path = img['gcs_uri']
                asset_data = {
                    "type": "image",
                    "gcs_uri": path,
                    "prompt": revised_prompt,
                    "model_used": model,
                    "resolution": image_size,
                    "status": "SUCCESS",
                    "trigger_time": trigger_time.isoformat(),
                    "completion_time": completion_time.isoformat(),
                }
                add_asset_to_creative_project(creative_project_id, asset_data, user_info)

    def on_generation_error(self, error: Exception, **kwargs):
        """Generic callback for failed generation tasks."""
        logger.error(f"Generation task failed. Logging error. Error: {error}", exc_info=False)
        user_info = kwargs.get('user_info')
        body = kwargs.get('body', {})
        prompt = kwargs.get('prompt') or body.get('prompt')
        trigger_time = kwargs.get('trigger_time')
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'
        
        is_image_gen = 'negative_prompt' in body or 'sub_prompt' in kwargs

        if is_image_gen:
            log_generation_to_bq(
                table_name=settings.IMAGEN_HISTORY_TABLE,
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=datetime.now(timezone.utc),
                operation_duration=0,
                prompt=prompt,
                negative_prompt=body.get('negative_prompt'),
                model_used=kwargs.get('model') or body.get('model'),
                status="FAILURE",
                error_message=str(error),
                aspect_ratio=body.get('aspect_ratio'),
                resolution=kwargs.get('image_size') or body.get('image_size'),
                creative_project_id=kwargs.get('creative_project_id') or body.get('creative_project_id')
            )
        else:
            log_generation_to_bq(
                table_name=settings.HISTORY_TABLE,
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=datetime.now(timezone.utc),
                operation_duration=0,
                prompt=prompt,
                model_used=body.get('model'),
                status="FAILURE",
                error_message=str(error),
                video_duration=body.get('duration'),
                with_audio=body.get('generateAudio', False),
                resolution=body.get('resolution'),
                first_frame_gcs_uri=body.get('image_gcs_uri'),
                last_frame_gcs_uri=body.get('final_frame_gcs_uri'),
                output_video_gcs_paths=[],
                creative_project_id=body.get('creative_project_id')
            )

    def _parse_rai_reason_from_error(self, error_message: str) -> Optional[Dict[str, str]]:
        """
        Parses the support code from a video generation error message and returns the mapped reason.
        """
        match = re.search(r"Support codes: (\d+)", error_message)
        if match:
            support_code = match.group(1)
            reason_details = {} # In a real app, this would come from a config
            if reason_details:
                return {
                    "code": support_code,
                    "category": reason_details.get("category", "Unknown"),
                    "description": reason_details.get("description", "An unknown safety filter was triggered."),
                    "filtered": reason_details.get("filtered", "N/A")
                }
            return {
                "code": support_code,
                "category": "Unknown",
                "description": "An unknown safety filter was triggered.",
                "filtered": "N/A"
            }
        return None

    def generate_video(
            self,
            prompt: str,
            user_info: Optional[Dict[str, Any]],
            **kwargs
    ) -> Dict[str, Any]:
        start_time = time.time()
        body = kwargs.get('body', {})
        model_id = body.get('model')
        aspect_ratio = body.get('aspectRatio', '16:9')
        duration_seconds = int(body.get('duration', 8))
        sample_count = int(body.get('sampleCount', 1))
        image_gcs_uri = body.get('image_gcs_uri')
        final_frame_gcs_uri = body.get('final_frame_gcs_uri')

        user_folder = "anonymous"
        if user_info and 'email' in user_info:
            user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_info['email']).lower()

        output_gcs_prefix = f"gs://{settings.VIDEO_BUCKET_NAME}/veo_outputs/{user_folder}/{uuid.uuid4().hex}"
        
        sdk_call_kwargs = {}

        config = types.GenerateVideosConfig(
            output_gcs_uri=output_gcs_prefix,
            aspect_ratio=aspect_ratio,
            duration_seconds=duration_seconds,
            number_of_videos=sample_count,
        )
        
        if image_gcs_uri:
            sdk_call_kwargs['image'] = types.Image(gcs_uri=image_gcs_uri, mime_type="image/jpeg")
        
        if final_frame_gcs_uri:
            config.last_frame = types.Image(gcs_uri=final_frame_gcs_uri, mime_type="image/jpeg")

        if body.get('enhancePrompt') is not None:
            config.enhance_prompt = body['enhancePrompt']

        if body.get('generateAudio') is not None:
            config.generate_audio = body['generateAudio']
        if body.get('resolution') is not None:
            config.resolution = body['resolution']
        
        if body.get('extend_duration') is not None:
            sdk_call_kwargs['video'] = types.Video(uri=image_gcs_uri)
            sdk_call_kwargs.pop('image', None)
            config.duration_seconds = body['extend_duration']

        operation = self.genai_client.models.generate_videos(
            model=model_id,
            prompt=prompt,
            config=config,
            **sdk_call_kwargs
        )

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
        revised_prompt = result.revised_prompt if hasattr(result, 'revised_prompt') else None
        
        generated_videos = result.generated_videos
        rai_reasons = None
        if not generated_videos:
            if hasattr(result, 'rai_media_filtered_reasons') and result.rai_media_filtered_reasons:
                raw_reasons = result.rai_media_filtered_reasons
                parsed_reasons = [self._parse_rai_reason_from_error(r) or r for r in raw_reasons]
                rai_reasons = parsed_reasons
        
        gcs_paths = [v.video.uri for v in generated_videos if v.video and v.video.uri]
        
        storage_client = storage.Client(project=settings.PROJECT_ID)
        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(GoogleAuthRequest())
        video_data = []
        for uri in gcs_paths:
            bucket_name, blob_name = uri[5:].split("/", 1)
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=60),
                method="GET",
                service_account_email=credentials.service_account_email,
                access_token=credentials.token,
            )
            video_data.append({"gcs_uri": uri, "signed_url": signed_url})

        return {
            "message": "Video generation successful.",
            "videos": video_data,
            "duration": time.time() - start_time,
            "revisedPrompt": revised_prompt,
            "rai_reasons": rai_reasons,
            "creative_project_id": kwargs.get('body').get('creative_project_id')
        }

    def generate_image(
            self,
            prompt: str,
            user_info: Optional[Dict[str, Any]],
            **kwargs
    ) -> Dict[str, Any]:
        start_time = time.time()
        model_used = kwargs.get('body').get('model')
        negative_prompt = kwargs.get('body').get('negative_prompt')
        aspect_ratio = kwargs.get('body').get('aspect_ratio')
        sample_count = kwargs.get('body').get('sample_count')
        image_size = kwargs.get('body').get('image_size')
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'

        try:
            images = self.imagen_client.models.generate_images(
                model=model_used,
                prompt=prompt,
                config=types.GenerateImagesConfig(
                    number_of_images=sample_count,
                    aspect_ratio=aspect_ratio,
                    negative_prompt=negative_prompt,
                    person_generation="allow_all",
                    safety_filter_level="BLOCK_MEDIUM_AND_ABOVE",
                    add_watermark=True,
                    image_size=image_size,
                    include_rai_reason=True
                )
            )
        except Exception as e:
            rai_reason = self._parse_rai_reason_from_error(str(e))
            if rai_reason:
                return {
                    "message": "Image generation failed due to safety filters.",
                    "images": [],
                    "duration": 0,
                    "prompt": prompt,
                    "model_used": model_used,
                    "resolution": image_size,
                    "rai_reasons": [rai_reason]
                }
            raise

        op_duration = time.time() - start_time

        gcs_paths = []
        rai_reasons = []
        for generated_image in images.generated_images:
            if generated_image.rai_filtered_reason:
                reason = self._parse_rai_reason_from_error(f"Support codes: {generated_image.rai_filtered_reason}")
                if reason:
                    rai_reasons.append(reason)
                else:
                    rai_reasons.append({"code": generated_image.rai_filtered_reason, "description": "Unknown reason"})
                continue

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                generated_image.image._pil_image.save(temp_file.name)
                
                user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
                blob_name = f"image_outputs/{user_folder}/{uuid.uuid4().hex}.png"
                
                storage_client = storage.Client(project=settings.PROJECT_ID)
                bucket = storage_client.bucket(settings.VIDEO_BUCKET_NAME)
                blob = bucket.blob(blob_name)
                blob.upload_from_filename(temp_file.name)
                
                gcs_paths.append(f"gs://{settings.VIDEO_BUCKET_NAME}/{blob_name}")

        storage_client = storage.Client(project=settings.PROJECT_ID)
        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(GoogleAuthRequest())
        image_data = []
        for uri in gcs_paths:
            bucket_name, blob_name = uri[5:].split("/", 1)
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=60),
                method="GET",
                service_account_email=credentials.service_account_email,
                access_token=credentials.token,
            )
            image_data.append({"gcs_uri": uri, "signed_url": signed_url})
        
        return {
            "message": "Image generation successful.",
            "images": image_data,
            "duration": op_duration,
            "prompt": prompt,
            "model_used": model_used,
            "resolution": image_size,
            "rai_reasons": rai_reasons if rai_reasons else None,
            "creative_project_id": kwargs.get('body').get('creative_project_id')
        }

    def imitate_image(
            self,
            user_info: Optional[Dict[str, Any]],
            file_bytes: bytes,
            file_content_type: str,
            file_filename: str,
            sub_prompt: str,
            model: str,
            sample_count: int,
            image_size: str,
            **kwargs
    ) -> Dict[str, Any]:
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'
        
        # 1. Upload image to GCS
        user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
        storage_client = storage.Client(project=settings.PROJECT_ID)
        bucket = storage_client.bucket(settings.VIDEO_BUCKET_NAME)
        file_extension = Path(file_filename).suffix
        blob_name = f"image_uploads/{user_folder}/{uuid.uuid4().hex}{file_extension}"
        blob = bucket.blob(blob_name)
        blob.upload_from_string(file_bytes, content_type=file_content_type)
        gcs_uri = f"gs://{settings.VIDEO_BUCKET_NAME}/{blob_name}"

        # 2. Describe the image with Gemini
        image_part = types.Part.from_uri(file_uri=gcs_uri, mime_type=file_content_type)
        response = self.genai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_text(text=IMAGE_IMITATION_PROMPT_PREFIX),
                image_part,
                types.Part.from_text(text=IMAGE_IMITATION_PROMPT_SUFFIX)
            ],
            config=generate_content_config
        )
        image_description = response.text
        combined_prompt_template = IMAGE_IMITATION_PROMPT_COMBINATION.format(image_description_json=image_description, cust_input_text=sub_prompt)
        response = self.genai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[types.Part.from_text(text=combined_prompt_template)],
            config=generate_content_config
        )
        combined_prompt = response.text

        # 3. Generate a new image
        start_time = time.time()
        images = self.imagen_client.models.generate_images(
            model=model,
            prompt=combined_prompt,
            config=types.GenerateImagesConfig(
                number_of_images=sample_count,
                person_generation="allow_all",
                safety_filter_level="BLOCK_MEDIUM_AND_ABOVE",
                add_watermark=True,
                image_size=image_size,
                include_rai_reason=True
            )
        )
        op_duration = time.time() - start_time

        gcs_paths = []
        rai_reasons = []
        for generated_image in images.generated_images:
            if generated_image.rai_filtered_reason:
                reason = self._parse_rai_reason_from_error(f"Support codes: {generated_image.rai_filtered_reason}")
                rai_reasons.append(reason or {"code": generated_image.rai_filtered_reason, "description": "Unknown reason"})
                continue

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                generated_image.image._pil_image.save(temp_file.name)
                user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
                blob_name = f"image_outputs/{user_folder}/{uuid.uuid4().hex}.png"
                blob = bucket.blob(blob_name)
                blob.upload_from_filename(temp_file.name)
                gcs_paths.append(f"gs://{settings.VIDEO_BUCKET_NAME}/{blob_name}")

        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(GoogleAuthRequest())
        image_data = []
        for uri in gcs_paths:
            bucket_name, blob_name = uri[5:].split("/", 1)
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=60),
                method="GET",
                service_account_email=credentials.service_account_email,
                access_token=credentials.token,
            )
            image_data.append({"gcs_uri": uri, "signed_url": signed_url})
            
        return {
            "message": "Image imitation successful.",
            "images": image_data,
            "duration": op_duration,
            "revised_prompt": combined_prompt,
            "model": model,
            "resolution": image_size,
            "rai_reasons": rai_reasons if rai_reasons else None,
            "gcs_paths": gcs_paths,
            "creative_project_id": kwargs.get('creative_project_id')
        }

def get_generation_service() -> GenerationService:
    return GenerationService(get_genai_client(), get_imagen_client())
