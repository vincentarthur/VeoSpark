import os
import uvicorn
import json
import logging
import re
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import google.auth
import google.genai as genai
import vertexai
from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import (APIRouter, Depends, FastAPI, File, Form, HTTPException,
                   Request, UploadFile)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.cloud import (bigquery, firestore, secretmanager, storage,
                          tasks_v2)
from google.cloud.firestore_v1.base_query import FieldFilter
from google.genai import types
from starlette.config import Config
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import JSONResponse, RedirectResponse, FileResponse
from vertexai.preview.vision_models import ImageGenerationModel

from app.config import settings
from app.dependencies import (get_bq_client, get_config_db,
                          get_creative_projects_db, get_db_client,
                          get_genai_client, get_groups_db, get_imagen_client,
                          get_prompt_gallery_db, get_shared_videos_db)
from app.schemas import (ImageGenerationRequest, TaskResponse,
                     TaskStatus, VideoGenerationRequest)
from app.services import GenerationService
from app.task_manager import create_task, get_task_status
from app.video_processing import check_quota, process_video_from_gcs
from app.routers.api import router as api_router
from app.routers.videos import router as videos_router
from app.routers.images import router as images_router
from app.routers.tools import router as tools_router


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ==============================================================================
# 3. FASTAPI APP AND MIDDLEWARE SETUP
# ==============================================================================

app = FastAPI(title="Veo Generation API")

SECRET_KEY = os.environ.get('SECRET_KEY', 'a-very-secret-key-for-dev')
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=7200)

origins = [
    settings.FRONTEND_URL,
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
    name = f"projects/{settings.PROJECT_ID}/secrets/{secret_id}/versions/{version_id}"
    try:
        response = client.access_secret_version(name=name)
        return response.payload.data.decode('UTF-8')
    except Exception as e:
        logger.critical(f"Failed to access secret '{secret_id}'. Error: {e}", exc_info=True)
        sys.exit(1)


if settings.ENABLE_OAUTH:

    secrets_str = get_oauth_secrets(settings.SECRET_ID)
    secrets = json.loads(secrets_str)
    ALLOWED_DOMAINS = settings.ALLOWED_DOMAINS

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
        redirect_uri = settings.REDIRECT_URI
        if not redirect_uri:
            logger.error("REDIRECT_URI is not configured. Cannot initiate login.")
            raise HTTPException(status_code=500, detail="Server configuration error: REDIRECT_URI is missing.")
        return await oauth.google.authorize_redirect(request, redirect_uri)


    @app.get('/auth')
    async def auth(request: Request):
        frontend_url = settings.FRONTEND_URL
        if not frontend_url:
            logger.error("FRONTEND_URL is not configured. Cannot complete auth.")
            raise HTTPException(status_code=500, detail="Server configuration error: FRONTEND_URL is missing.")
        try:
            token = await oauth.google.authorize_access_token(request)
            user_info = dict(token)["userinfo"]

            # user_hd = user_info.get('hd')
            # if ALLOWED_DOMAINS and user_hd not in ALLOWED_DOMAINS:
            #     logger.warning(f"Unauthorized domain: {user_hd}")
            #     return RedirectResponse(url=f"{frontend_url}/login?error=domain_not_allowed")
            
            user_domain = (user_info.get('email').split('@')[1]).lower()
            if ALLOWED_DOMAINS and user_domain not in ALLOWED_DOMAINS:
                logger.warning(f"Unauthorized domain: {user_domain}")
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


app.include_router(api_router, prefix="/api")
app.include_router(videos_router, prefix="/api/videos", tags=["Video Generation"])
app.include_router(images_router, prefix="/api/images", tags=["Image Generation"])
app.include_router(tools_router, prefix="/api/tools", tags=["Tools"])


# ==============================================================================
# 6. APP ROUTING AND STARTUP
# ==============================================================================
# This must be placed at the end, after all other API and auth routes have been defined.
# It acts as a catch-all to serve the React application.
@app.middleware("http")
async def catch_all_middleware(request: Request, call_next):
    response = await call_next(request)
    if response.status_code == 404 and not request.url.path.startswith('/api/') and '.' not in request.url.path:
        return FileResponse("static/index.html")
    return response

app.mount("/static", StaticFiles(directory="static/static"), name="static_assets")
app.mount("/", StaticFiles(directory="static", html=True), name="app")


if __name__ == '__main__':
    port = int(os.getenv("PORT", "7860"))
    logger.info(f"Starting Uvicorn server on http://0.0.0.0:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
