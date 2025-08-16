from functools import lru_cache
from google.cloud import bigquery, firestore
from config import settings
import google.auth
import google.genai as genai
from vertexai.preview.vision_models import ImageGenerationModel
import vertexai
from fastapi import Request
from typing import Optional

def get_user(request: Request) -> Optional[dict]:
    user = request.session.get('user')
    if user:
        app_admins = settings.APP_ADMINS
        user_email = user.get('email')
        user['role'] = 'APP_ADMIN' if user_email in app_admins else 'USER'
    return user

@lru_cache()
def get_bq_client():
    if settings.ENABLE_BIGQUERY_LOGGING:
        return bigquery.Client(project=settings.PROJECT_ID)
    return None

@lru_cache()
def get_db_client(database: str):
    return firestore.Client(project=settings.PROJECT_ID, database=database)

def get_prompt_gallery_db():
    return get_db_client(settings.PROMPT_GALLERY_DB)

def get_config_db():
    return get_db_client(settings.CONFIG_DB)

def get_groups_db():
    return get_db_client(settings.GROUPS_DB)

def get_creative_projects_db():
    return get_db_client(settings.CREATIVE_PROJECTS_DB)

def get_shared_videos_db():
    return get_db_client(settings.SHARED_VIDEOS_DB)

@lru_cache()
def get_genai_client():
    return genai.Client(vertexai=True, project=settings.PROJECT_ID, location=settings.LOCATION)

@lru_cache()
def get_imagen_client():
    return genai.Client(vertexai=True, project=settings.PROJECT_ID, location='us-central1')
