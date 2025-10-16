import time
import uuid
import re
import json
import yaml
from pathlib import Path
import tempfile
from typing import Dict, Any, Optional, List, Tuple
from app.config import settings
from app.dependencies import get_genai_client, get_imagen_client, get_storage_client
from app.config_manager import get_models_config, get_price_for_model
from google.cloud import storage
import google.genai as genai
from google.genai import types
import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest
from datetime import datetime, timedelta, timezone
import logging
from google.cloud import bigquery, firestore
from google.cloud.firestore_v1.vector import Vector
from app.prompts import IMAGE_ENRICHMENT_PROMPT_PREFIX, IMAGE_ENRICHMENT_PROMPT_SUFFIX, IMAGE_ENRICHMENT_PROMPT_COMBINATION
from PIL import Image
from io import BytesIO
import vertexai
from vertexai.vision_models import Image as VisionImage, Video as VisionVideo, MultiModalEmbeddingModel
from google.api_core import exceptions as google_api_exceptions

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

def log_generation_to_bq(asset_type: str, **kwargs):
    if not settings.ENABLE_BIGQUERY_LOGGING:
        return

    bq_client = bigquery.Client(project=settings.PROJECT_ID)
    if asset_type == "imgen":
        table_name = settings.IMAGEN_HISTORY_TABLE
    elif asset_type == "veo":
        table_name = settings.HISTORY_TABLE
    elif asset_type == "image_enrichment":
        table_name = settings.IMAGE_ENRICHMENT_HISTORY_TABLE
    else:
        logger.error(f"Unknown BigQuery table type: {asset_type}")
        return
    
    table_id = f"{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{table_name}"
    
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
            self.embedding_client = genai.Client(vertexai=True, project=self.project_id, location=settings.LOCATION_MULTIMODAL_EMBEDDING_MODEL)
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
                service_account_email=self._credentials.service_account_email,
                access_token=self._credentials.token,
            )
        except Exception as e:
            self.logger.error(f"Failed to generate signed URL for {gcs_uri}: {e}", exc_info=True)
            return ""

class GenerationService:
    def __init__(self, genai_client, imagen_client, storage_client):
        self.genai_client = genai_client
        self.imagen_client = imagen_client
        self.storage_client = storage_client
        try:
            vertexai.init(project=settings.PROJECT_ID, location=settings.LOCATION_MULTIMODAL_EMBEDDING_MODEL)
            self.embedding_model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")
            logger.info("MultiModalEmbeddingModel initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize MultiModalEmbeddingModel: {e}", exc_info=True)
            self.embedding_model = None

    def generate_video_embedding(self, gcs_uri: str) -> dict:
        """
        Generates a description and embeddings for a single video.
        """
        logger.info(f"Starting to process video: {gcs_uri}")

        if not isinstance(gcs_uri, str) or not gcs_uri.startswith("gs://"):
            raise ValueError(f"Invalid GCS URI provided: '{gcs_uri}'")

        description = ""
        try:
            logger.info(f"Generating description for {gcs_uri} using model {settings.GEMINI_MODEL}.")
            video_part = types.Part.from_uri(file_uri=gcs_uri, mime_type="video/mp4")
            description_prompt = "Describe this video in detail. Focus on the main subjects, background, style, colors, mood and overall description. Output within 200 words"

            response = self.genai_client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=[description_prompt, video_part],
                config=generate_content_config
            )
            description = response.text.strip()
            logger.info(f"Successfully generated description for {gcs_uri}.")

        except (google_api_exceptions.GoogleAPICallError, ValueError) as e:
            logger.error(f"Failed to generate description for {gcs_uri}. Error: {e}")
            raise

        try:
            logger.info(f"Generating embeddings for {gcs_uri}.")
            embeddings = self.embedding_model.get_embeddings(
                video=VisionVideo.load_from_file(gcs_uri),
                contextual_text=description[:1000]
            )
            logger.info(f"Successfully generated embeddings for {gcs_uri}.")

            return {
                "description": description,
                "desc_embedding": embeddings.text_embedding,
                "video_embedding": embeddings.video_embeddings[0].embedding,
            }

        except (google_api_exceptions.GoogleAPICallError, ValueError) as e:
            logger.error(f"Failed to generate embeddings for {gcs_uri}. Error: {e}")
            raise

    def generate_image_embedding(self, gcs_uri: str) -> dict:
        """
        Generates a description and embeddings for a single image.
        """
        logger.info(f"Starting to process image: {gcs_uri}")

        if not isinstance(gcs_uri, str) or not gcs_uri.startswith("gs://"):
            raise ValueError(f"Invalid GCS URI provided: '{gcs_uri}'")

        description = ""
        try:
            logger.info(f"Generating description for {gcs_uri} using model {settings.GEMINI_MODEL}.")
            mime_type = 'image/png' if gcs_uri.endswith('.png') else 'image/jpeg'
            image_part = types.Part.from_uri(file_uri=gcs_uri, mime_type=mime_type)
            description_prompt = "Describe this image in detail. Focus on the main subjects, background, style, colors, mood and overall description. Output within 200 words"

            response = self.genai_client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=[description_prompt, image_part],
                config=generate_content_config
            )
            description = response.text.strip()
            logger.info(f"Successfully generated description for {gcs_uri}.")

        except (google_api_exceptions.GoogleAPICallError, ValueError) as e:
            logger.error(f"Failed to generate description for {gcs_uri}. Error: {e}")
            raise

        try:
            logger.info(f"Generating embeddings for {gcs_uri}.")
            embeddings = self.embedding_model.get_embeddings(
                image=VisionImage.load_from_file(gcs_uri),
                contextual_text=description[:1000]
            )
            logger.info(f"Successfully generated embeddings for {gcs_uri}.")

            return {
                "description": description,
                "desc_embedding": embeddings.text_embedding,
                "image_embedding": embeddings.image_embedding,
            }

        except (google_api_exceptions.GoogleAPICallError, ValueError) as e:
            logger.error(f"Failed to generate embeddings for {gcs_uri}. Error: {e}")
            raise

    def on_video_generation_success(self, result: Dict[str, Any], **kwargs):
        """Callback for successful video generation."""
        if "error" in result:
            logger.error(f"Video generation failed, processing error callback. Error: {result['error']}")
            self.on_generation_error(
                error=Exception(str(result["error"])),
                asset_type='veo',
                **kwargs
            )
            return

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

        model_id = body.get('model')
        video_duration = body.get('duration')
        with_audio = body.get('generateAudio', False)
        price_info = get_price_for_model(model_id, trigger_time, 'video')
        cost = 0
        if price_info and video_duration:
            price_key = 'video_with_audio' if with_audio else 'video_without_audio'
            price_per_second = price_info.get(price_key, 0)
            cost = price_per_second * video_duration
        
        for video in video_data:
            path = video['gcs_uri']

            embedding_data = {}
            if self.embedding_model:
                try:
                    embedding_data = self.generate_video_embedding(path)
                except Exception as e:
                    logger.error(f"Failed to process video and generate embedding for {path}: {e}")

            log_generation_to_bq(
                asset_type='veo',
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
                output_video_gcs_paths=json.dumps([path]),
                creative_project_id=body.get('creative_project_id'),
                cost=cost,
                **embedding_data
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

        model_id = body.get('model')
        price_info = get_price_for_model(model_id, trigger_time, 'image')
        cost_per_image = price_info.get('per_image', 0) if price_info else 0
        
        for img in image_data:
            path = img['gcs_uri']

            embedding_data = {}
            if self.embedding_model:
                try:
                    embedding_data = self.generate_image_embedding(path)
                except Exception as e:
                    logger.error(f"Failed to process image and generate embedding for {path}: {e}")

            log_generation_to_bq(
                asset_type='imgen',
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
                creative_project_id=body.get('creative_project_id'),
                cost=cost_per_image,
                **embedding_data
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

    def on_image_enrichment_success(self, result: Dict[str, Any], **kwargs):
        """Callback for successful image enrichment."""
        logger.info("Image enrichment succeeded. Processing results.")
        user_info = kwargs.get('user_info')
        creative_project_id = kwargs.get('creative_project_id')
        trigger_time = kwargs.get('trigger_time')

        image_data = result.get("images", [])
        op_duration = result.get("duration", 0)
        revised_prompt = result.get("revised_prompt")
        model = result.get("model")
        aspect_ratio = result.get("aspect_ratio")
        input_token = result.get("input_token", 0)
        output_token = result.get("output_token", 0)
        
        completion_time = datetime.now(timezone.utc)
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'

        price_info = get_price_for_model(model, trigger_time, 'image_enrichment')
        cost = 0
        if price_info:
            cost_per_million_input = price_info.get('cost_per_million_input_token', 0)
            cost_per_million_output = price_info.get('cost_per_million_output_token', 0)
            input_cost = (input_token / 1_000_000) * cost_per_million_input
            output_cost = (output_token / 1_000_000) * cost_per_million_output
            cost = input_cost + output_cost

        cost_per_image = cost / len(image_data) if image_data else 0

        for img in image_data:
            path = img['gcs_uri']
            resolution = img.get('resolution')
            embedding_data = {}
            if self.embedding_model:
                try:
                    embedding_data = self.generate_image_embedding(path)
                except Exception as e:
                    logger.error(f"Failed to process image and generate embedding for {path}: {e}")

            log_generation_to_bq(
                asset_type='image_enrichment',
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=completion_time,
                operation_duration=op_duration / len(image_data) if image_data else 0,
                prompt=revised_prompt,
                negative_prompt=None,
                model_used=model,
                status="SUCCESS",
                output_image_gcs_path=path,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
                creative_project_id=creative_project_id,
                cost=cost_per_image,
                input_token=input_token,
                output_token=output_token,
                **embedding_data
            )

        if creative_project_id and image_data:
            for img in image_data:
                path = img['gcs_uri']
                resolution = img.get('resolution')
                asset_data = {
                    "type": "image",
                    "gcs_uri": path,
                    "prompt": revised_prompt,
                    "model_used": model,
                    "resolution": resolution,
                    "aspect_ratio": aspect_ratio,
                    "status": "SUCCESS",
                    "trigger_time": trigger_time.isoformat(),
                    "completion_time": completion_time.isoformat(),
                }
                add_asset_to_creative_project(creative_project_id, asset_data, user_info)

    def on_generation_error(self, error: Exception, asset_type: str, **kwargs):
        """Generic callback for failed generation tasks."""
        logger.error(f"Generation task failed. Logging error. Error: {error}", exc_info=False)
        user_info = kwargs.get('user_info')
        body = kwargs.get('body', {})
        prompt = kwargs.get('prompt') or body.get('prompt')
        trigger_time = kwargs.get('trigger_time')
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'
        
        if asset_type == "imgen":
            log_generation_to_bq(
                asset_type='imgen',
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
        elif asset_type == "veo":
            log_generation_to_bq(
                asset_type='veo',
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
                output_video_gcs_paths=json.dumps([]),
                creative_project_id=body.get('creative_project_id')
            )
        elif asset_type == "image_enrichment":
            log_generation_to_bq(
                asset_type='image_enrichment',
                user_email=user_email,
                trigger_time=trigger_time,
                completion_time=datetime.now(timezone.utc),
                operation_duration=0,
                prompt=prompt,
                model_used=kwargs.get('model'),
                status="FAILURE",
                error_message=str(error),
                resolution=kwargs.get('image_size'),
                creative_project_id=kwargs.get('creative_project_id')
            )

    def _parse_rai_reason_from_error(self, error_message: str) -> Optional[List[Dict[str, str]]]:
        """
        Parses support codes from a generation error message and returns the mapped reasons.
        """
        try:
            config_path = Path(__file__).parent.parent / 'configs' / 'safety_filters.yaml'
            with open(config_path, "r") as f:
                safety_filters = yaml.safe_load(f)
        except (FileNotFoundError, yaml.YAMLError) as e:
            logger.error(f"Failed to load or parse safety_filters.yaml: {e}")
            safety_filters = {}

        matches = re.findall(r"Support codes: ([\d, ]+)", error_message)
        if not matches:
            return None

        all_codes = []
        for match in matches:
            codes = [code.strip() for code in match.split(',') if code.strip().isdigit()]
            all_codes.extend(codes)

        if not all_codes:
            return None

        reasons = []
        for code in all_codes:
            reason = safety_filters.get(code, {
                "category": "Unknown",
                "description": "An unknown safety filter was triggered.",
                "filtered": "N/A"
            })
            reasons.append({
                "code": code,
                "category": reason.get("category", "Unknown"),
                "description": reason.get("description", "No description available."),
                "filtered": reason.get("filtered", "N/A")
            })
        return reasons

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
        
        is_veo2_model = model_id.startswith('veo-2.')
        is_veo31_model = model_id.startswith('veo-3.1')

        if (is_veo2_model or is_veo31_model) and body.get('generationMode') == 'extend':
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
            error_str = str(operation.error)
            rai_reasons = self._parse_rai_reason_from_error(error_str)
            return {
                "message": "Video generation failed.",
                "error": error_str,
                "videos": [],
                "duration": time.time() - start_time,
                "revisedPrompt": None,
                "rai_reasons": rai_reasons,
                "creative_project_id": kwargs.get('body').get('creative_project_id')
            }
        if not operation.response:
            return {
                "message": "Operation finished but no response data found.",
                "error": "No response data",
                "videos": [],
                "duration": time.time() - start_time,
                "revisedPrompt": None,
                "rai_reasons": None,
                "creative_project_id": kwargs.get('body').get('creative_project_id')
            }

        result = operation.result
        revised_prompt = result.revised_prompt if hasattr(result, 'revised_prompt') else None
        
        generated_videos = result.generated_videos
        rai_reasons = None
        if not generated_videos:
            if hasattr(result, 'rai_media_filtered_reasons') and result.rai_media_filtered_reasons:
                rai_reasons = []
                for r in result.rai_media_filtered_reasons:
                    parsed = self._parse_rai_reason_from_error(r)
                    if parsed:
                        rai_reasons.extend(parsed)
                    else:
                        rai_reasons.append({"code": "Unknown", "description": r})
        
        gcs_paths = [v.video.uri for v in generated_videos if v.video and v.video.uri]
        
        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(GoogleAuthRequest())
        video_data = []
        for uri in gcs_paths:
            bucket_name, blob_name = uri[5:].split("/", 1)
            bucket = self.storage_client.bucket(bucket_name)
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
                reason_str = f"Support codes: {generated_image.rai_filtered_reason}"
                parsed_reasons = self._parse_rai_reason_from_error(reason_str)
                if parsed_reasons:
                    rai_reasons.extend(parsed_reasons)
                else:
                    rai_reasons.append({"code": generated_image.rai_filtered_reason, "description": "Unknown reason"})
                continue

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                generated_image.image._pil_image.save(temp_file.name)
                
                user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
                blob_name = f"image_outputs/{user_folder}/{uuid.uuid4().hex}.png"
                
                bucket = self.storage_client.bucket(settings.VIDEO_BUCKET_NAME)
                blob = bucket.blob(blob_name)
                blob.upload_from_filename(temp_file.name)
                
                gcs_paths.append(f"gs://{settings.VIDEO_BUCKET_NAME}/{blob_name}")

        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(GoogleAuthRequest())
        image_data = []
        for uri in gcs_paths:
            bucket_name, blob_name = uri[5:].split("/", 1)
            bucket = self.storage_client.bucket(bucket_name)
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

    def enrich_image(
            self,
            user_info: Optional[Dict[str, Any]],
            sub_prompt: str,
            model: str,
            aspect_ratio: str,
            files: Optional[List[Dict[str, Any]]] = None,
            previous_image_gcs_paths: Optional[List[str]] = None,
            conversation_history: Optional[List[Dict[str, Any]]] = None,
            **kwargs
    ) -> Dict[str, Any]:
        user_email = user_info.get('email', 'anonymous') if user_info else 'anonymous'
        gcs_uris = []
        bucket = self.storage_client.bucket(settings.VIDEO_BUCKET_NAME)
        
        if previous_image_gcs_paths:
            gcs_uris.extend(previous_image_gcs_paths)
        elif files:
            user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
            for file in files:
                file_extension = Path(file["file_filename"]).suffix
                blob_name = f"image_uploads/{user_folder}/{uuid.uuid4().hex}{file_extension}"
                blob = bucket.blob(blob_name)
                blob.upload_from_string(file["file_bytes"], content_type=file["file_content_type"])
                gcs_uris.append(f"gs://{settings.VIDEO_BUCKET_NAME}/{blob_name}")
        else:
            raise ValueError("Either file data or previous_image_gcs_paths must be provided.")

        image_parts = [types.Part.from_uri(file_uri=uri, mime_type='image/png' if uri.endswith('.png') else 'image/jpeg') for uri in gcs_uris]

        start_time = time.time()

        contents = []
        if conversation_history:
            for entry in conversation_history:
                if entry.get('type') == 'user':
                    contents.append(types.Part.from_text(text=f"user: {entry['prompt']}"))
                elif entry.get('type') == 'model':
                    contents.append(types.Part.from_text(text=f"model: {entry['prompt']}"))

        contents.append(types.Part.from_text(text=sub_prompt))
        contents.extend(image_parts)

        response = self.genai_client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio=aspect_ratio
                )
            )
        )
        op_duration = time.time() - start_time

        input_token = response.usage_metadata.prompt_token_count
        output_token = response.usage_metadata.candidates_token_count

        gcs_paths = []
        rai_reasons = []
        resolution = None
        image_data = []

        candidate = response.candidates[0]
        if candidate.safety_ratings:
            # Got issue with Safety Filter
            reason_str = f"Support codes: {candidate.safety_ratings.category}"
            parsed_reasons = self._parse_rai_reason_from_error(reason_str)
            if parsed_reasons:
                rai_reasons.extend(parsed_reasons)
            else:
                rai_reasons.append({"code": candidate.safety_ratings.category, "description": "Unknown reason"})
        else:
            for part in candidate.content.parts:
                if part.inline_data:
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                        pil_image = Image.open(BytesIO(part.inline_data.data))
                        resolution = f"{pil_image.width}x{pil_image.height}"
                        pil_image.save(temp_file.name)
                    user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
                    blob_name = f"image_outputs/{user_folder}/{uuid.uuid4().hex}.png"
                    blob = bucket.blob(blob_name)
                    blob.upload_from_filename(temp_file.name)
                    gcs_path = f"gs://{settings.VIDEO_BUCKET_NAME}/{blob_name}"
                    gcs_paths.append(gcs_path)
                    
                    credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
                    credentials.refresh(GoogleAuthRequest())
                    signed_url = blob.generate_signed_url(
                        version="v4",
                        expiration=timedelta(minutes=60),
                        method="GET",
                        service_account_email=credentials.service_account_email,
                        access_token=credentials.token,
                    )
                    image_data.append({"gcs_uri": gcs_path, "signed_url": signed_url, "resolution": resolution})
            
        return {
            "message": "Image enrichment successful.",
            "images": image_data,
            "duration": op_duration,
            "revised_prompt": sub_prompt,
            "model": model,
            "aspect_ratio": aspect_ratio,
            "rai_reasons": rai_reasons if rai_reasons else None,
            "gcs_paths": gcs_paths,
            "creative_project_id": kwargs.get('creative_project_id'),
            "input_token": input_token,
            "output_token": output_token
        }

def get_generation_service() -> GenerationService:
    return GenerationService(get_genai_client(), get_imagen_client(), get_storage_client())
