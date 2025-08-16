from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from schemas import TaskStatus
from services import GenerationService, get_generation_service
from config import settings
from dependencies import get_bq_client, get_config_db, get_prompt_gallery_db, get_shared_videos_db, get_groups_db, get_creative_projects_db
from video_processing import check_quota, process_video_from_gcs
from services import log_generation_to_bq
from config_manager import get_project_config, save_project_config, save_bulk_project_configs, get_config, save_config, get_image_models, get_models_config
from google.cloud import bigquery, firestore, storage
from dependencies import get_user
from services import VeoApiClient
import logging
from datetime import datetime, timezone, timedelta
from task_manager import get_task_status
from typing import Optional, List, Dict, Any
from pathlib import Path
import json
import re
import uuid
from starlette.responses import JSONResponse
from google.cloud.firestore_v1.base_query import FieldFilter
import google.genai as genai
from google.genai import types

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/user/me", tags=["User"])
def get_current_user_details(user: dict = Depends(get_user)):
    if not user:
        return JSONResponse({"authenticated": False}, status_code=401)

    cost_managers = settings.COST_MANAGERS
    app_admins = settings.APP_ADMINS
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

@router.get("/config", tags=["Configuration"])
def get_app_config():
    """
    Returns public configuration details to the frontend.
    """
    return JSONResponse({
        "prompt_gallery_name": settings.PROMPT_GALLERY_COLLECTION,
        "enable_upscale": settings.ENABLE_UPSCALE
    })

@router.get("/models", tags=["Configuration"])
def get_models():
    """
    Returns the available models from the configuration.
    """
    return JSONResponse(get_models_config())


@router.get("/image-models", tags=["Configuration"])
def get_image_models_endpoint():
    """
    Returns the available image models from the configuration.
    """
    return JSONResponse(get_image_models())

@router.get("/notification-banner", tags=["Configuration"])
def get_notification_banner():
    """
    Returns a list of notification banner messages if set in the config.
    """
    return JSONResponse({"messages": settings.BANNER_MESSAGES})

@router.get("/tasks/{task_id}", tags=["Tasks"], response_model=TaskStatus)
def get_task_status_endpoint(task_id: str):
    """
    Retrieves the status of a background task.
    """
    status = get_task_status(task_id)
    return TaskStatus(**status)

@router.get("/configurations", tags=["Configuration"])
def get_configurations(user: dict = Depends(get_user), config_db: firestore.Client = Depends(get_config_db)):
    
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    return get_config(config_db)


@router.post("/configurations", tags=["Configuration"])
async def set_configurations(request: Request, user: dict = Depends(get_user), config_db: firestore.Client = Depends(get_config_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    config = await request.json()
    save_config(config, config_db)
    return {"message": "Configuration saved successfully."}

@router.get("/gcs/videos", tags=["GCS"])
def list_user_videos(user: dict = Depends(get_user), prefix: Optional[str] = None):
    """
    Lists all video files in the user's GCS folder, optionally filtered by a prefix.
    """
    if settings.ENABLE_OAUTH and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
    
    search_prefix = prefix if prefix else f"veo_outputs/{user_folder}/"

    try:
        storage_client = storage.Client(project=settings.PROJECT_ID)
        bucket = storage_client.bucket(settings.VIDEO_BUCKET_NAME)
        blobs = bucket.list_blobs(prefix=search_prefix)

        videos = []
        veo_client = VeoApiClient(settings.PROJECT_ID, settings.LOCATION, settings.VIDEO_BUCKET_NAME)
        for blob in blobs:
            if blob.name.lower().endswith(('.mp4', '.mov', '.avi', '.mkv')):
                gcs_uri = f"gs://{settings.VIDEO_BUCKET_NAME}/{blob.name}"
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

@router.post("/prompts", tags=["Prompt Gallery"])
async def add_prompt_to_gallery(request: Request, user: dict = Depends(get_user), prompt_gallery_db: firestore.Client = Depends(get_prompt_gallery_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not prompt_gallery_db:
        raise HTTPException(status_code=503, detail="Firestore is not configured")

    body = await request.json()
    prompt_text = body.get("prompt_text")
    keywords = body.get("keywords", [])

    if not prompt_text:
        raise HTTPException(status_code=400, detail="Prompt text is required.")

    doc_ref = prompt_gallery_db.collection(settings.PROMPT_GALLERY_COLLECTION).document()
    doc_ref.set({
        "prompt_text": prompt_text,
        "keywords": keywords,
        "created_by_email": user.get("email"),
        "created_by_name": user.get("name"),
        "created_at": firestore.SERVER_TIMESTAMP
    })
    return JSONResponse({"message": "Prompt added successfully", "id": doc_ref.id}, status_code=201)


@router.get("/prompts", tags=["Prompt Gallery"])
def get_prompts_from_gallery(tags: Optional[str] = None, page: int = 1, page_size: int = 10, prompt_gallery_db: firestore.Client = Depends(get_prompt_gallery_db)):
    if not prompt_gallery_db:
        raise HTTPException(status_code=503, detail="Firestore is not configured")

    prompts_ref = prompt_gallery_db.collection(settings.PROMPT_GALLERY_COLLECTION)
    
    tag_list = [tag.strip() for tag in tags.split(',')] if tags else []
    
    count_query = prompts_ref
    if tag_list:
        for tag in tag_list:
            count_query = count_query.where(filter=FieldFilter("keywords", "array_contains", tag))
            
    total_rows = len(list(count_query.stream()))

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


@router.delete("/prompts/{prompt_id}", tags=["Prompt Gallery"])
def delete_prompt_from_gallery(prompt_id: str, user: dict = Depends(get_user), prompt_gallery_db: firestore.Client = Depends(get_prompt_gallery_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not prompt_gallery_db:
        raise HTTPException(status_code=503, detail="Firestore is not configured")

    doc_ref = prompt_gallery_db.collection(settings.PROMPT_GALLERY_COLLECTION).document(prompt_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Prompt not found")

    if doc.to_dict().get("created_by_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only delete your own prompts")

    doc_ref.delete()
    return JSONResponse({"message": "Prompt deleted successfully"})

@router.post("/images/upload", tags=["Image Upload"])
async def upload_image_endpoint(user: dict = Depends(get_user), file: UploadFile = File(...)):
    """
    Uploads an image to GCS and returns its URI.
    """
    if settings.ENABLE_OAUTH and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Only images are allowed.")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    user_folder = re.sub(r'[^a-zA-Z0-9_.-]', '_', user_email).lower()
    
    try:
        storage_client = storage.Client(project=settings.PROJECT_ID)
        bucket = storage_client.bucket(settings.VIDEO_BUCKET_NAME)
        
        file_extension = Path(file.filename).suffix
        blob_name = f"image_uploads/{user_folder}/{uuid.uuid4().hex}{file_extension}"
        blob = bucket.blob(blob_name)

        blob.upload_from_file(file.file, content_type=file.content_type)
        
        gcs_uri = f"gs://{settings.VIDEO_BUCKET_NAME}/{blob.name}"
        logger.info(f"User {user_email} uploaded image to {gcs_uri}")

        return JSONResponse({
            "message": "Image uploaded successfully.",
            "gcs_uri": gcs_uri
        }, status_code=200)

    except Exception as e:
        logger.error(f"Image upload failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image upload failed: {e}")

@router.post("/videos/edit", tags=["Video Editing"])
async def edit_video_endpoint(request: Request, user: dict = Depends(get_user)):
    """
    Edits a video based on the provided parameters (e.g., clipping).
    """
    if settings.ENABLE_OAUTH and not user:
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
            project_id=settings.PROJECT_ID,
            gcs_uri=gcs_uri,
            operation='clip',
            user_folder=user_folder,
            start_time=start_time,
            end_time=end_time
        )
        op_duration = time.time() - op_start_time

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

        veo_client = VeoApiClient(settings.PROJECT_ID, settings.LOCATION, settings.VIDEO_BUCKET_NAME)
        signed_url = veo_client.generate_signed_gcs_url(processed_gcs_uri)

        return JSONResponse({
            "message": "Video clipped successfully.",
            "processed_video_uri": processed_gcs_uri,
            "signed_url": signed_url
        }, status_code=200)

    except Exception as e:
        logger.error(f"Video editing failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video editing failed: {e}")


@router.post("/videos/dub", tags=["Video Editing"])
async def dub_video_endpoint(request: Request, user: dict = Depends(get_user)):
    """
    Adds a text-to-speech voiceover to a video.
    """
    if settings.ENABLE_OAUTH and not user:
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
            project_id=settings.PROJECT_ID,
            gcs_uri=gcs_uri,
            operation='dub',
            user_folder=user_folder,
            text=text
        )
        op_duration = time.time() - op_start_time

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

        veo_client = VeoApiClient(settings.PROJECT_ID, settings.LOCATION, settings.VIDEO_BUCKET_NAME)
        signed_url = veo_client.generate_signed_gcs_url(processed_gcs_uri)

        return JSONResponse({
            "message": "Voiceover added successfully.",
            "processed_video_uri": processed_gcs_uri,
            "signed_url": signed_url
        }, status_code=200)

    except Exception as e:
        logger.error(f"Video dubbing failed for user {user_email}. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video dubbing failed: {e}")

@router.post("/groups", tags=["Groups"])
async def create_group(request: Request, user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db)):
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


@router.get("/groups", tags=["Groups"])
def get_groups(user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db)):
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


@router.post("/groups/{group_id}/members", tags=["Groups"])
async def add_group_member(group_id: str, request: Request, user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db)):
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


@router.delete("/groups/{group_id}/members/{member_email}", tags=["Groups"])
def remove_group_member(group_id: str, member_email: str, user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not groups_db:
        raise HTTPException(status_code=503, detail="Groups database is not configured")

    doc_ref = groups_db.collection('groups').document(group_id)
    doc_ref.update({
        "members": firestore.ArrayRemove([member_email])
    })
    return JSONResponse({"message": "Member removed successfully."})


@router.post("/groups/{group_id}/members/bulk", tags=["Groups"])
async def bulk_add_group_members(group_id: str, request: Request, user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db)):
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


@router.delete("/groups/{group_id}/members/bulk", tags=["Groups"])
async def bulk_remove_group_members(group_id: str, request: Request, user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db)):
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


@router.post("/creative-projects", tags=["Creative Projects"])
async def create_creative_project(request: Request, user: dict = Depends(get_user), creative_projects_db: firestore.Client = Depends(get_creative_projects_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not creative_projects_db:
        raise HTTPException(status_code=503, detail="Creative projects database is not configured")

    body = await request.json()
    project_name = body.get("name")
    members = body.get("members", [])

    if not project_name:
        raise HTTPException(status_code=400, detail="Project name is required.")

    doc_ref = creative_projects_db.collection('projects').document()
    doc_ref.set({
        "name": project_name,
        "members": members,
        "created_by": user.get("email"),
        "created_at": firestore.SERVER_TIMESTAMP
    })
    return JSONResponse({"message": "Creative project created successfully", "id": doc_ref.id}, status_code=201)


@router.get("/creative-projects", tags=["Creative Projects"])
def get_creative_projects(user: dict = Depends(get_user), creative_projects_db: firestore.Client = Depends(get_creative_projects_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not creative_projects_db:
        raise HTTPException(status_code=503, detail="Creative projects database is not configured")

    if user.get('role') == 'APP_ADMIN':
        projects_ref = creative_projects_db.collection('projects')
    else:
        user_email = user.get('email')
        projects_ref = creative_projects_db.collection('projects').where(filter=FieldFilter('members', 'array_contains', user_email))
    
    projects = []
    for doc in projects_ref.stream():
        project_data = doc.to_dict()
        project_data["id"] = doc.id
        if 'created_at' in project_data and hasattr(project_data['created_at'], 'isoformat'):
            project_data['created_at'] = project_data['created_at'].isoformat()
        projects.append(project_data)

    return JSONResponse(projects)


@router.post("/creative-projects/{project_id}/members", tags=["Creative Projects"])
async def add_project_member(project_id: str, request: Request, user: dict = Depends(get_user), creative_projects_db: firestore.Client = Depends(get_creative_projects_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not creative_projects_db:
        raise HTTPException(status_code=503, detail="Creative projects database is not configured")

    body = await request.json()
    member_email = body.get("email")

    if not member_email:
        raise HTTPException(status_code=400, detail="Member email is required.")

    doc_ref = creative_projects_db.collection('projects').document(project_id)
    doc_ref.update({
        "members": firestore.ArrayUnion([member_email])
    })
    return JSONResponse({"message": "Member added successfully."})


@router.delete("/creative-projects/{project_id}/members/{member_email}", tags=["Creative Projects"])
def remove_project_member(project_id: str, member_email: str, user: dict = Depends(get_user), creative_projects_db: firestore.Client = Depends(get_creative_projects_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not creative_projects_db:
        raise HTTPException(status_code=503, detail="Creative projects database is not configured")

    doc_ref = creative_projects_db.collection('projects').document(project_id)
    doc_ref.update({
        "members": firestore.ArrayRemove([member_email])
    })
    return JSONResponse({"message": "Member removed successfully."})


@router.get("/creative-projects/{project_id}/config", tags=["Creative Projects"])
def get_project_config_endpoint(project_id: str, user: dict = Depends(get_user), config_db: firestore.Client = Depends(get_config_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not config_db:
        raise HTTPException(status_code=503, detail="Configuration database is not configured")
    
    config = get_project_config(config_db, project_id)
    if not config:
        return JSONResponse({})
    return JSONResponse(config)


@router.post("/creative-projects/{project_id}/config", tags=["Creative Projects"])
async def save_project_config_endpoint(project_id: str, request: Request, user: dict = Depends(get_user), config_db: firestore.Client = Depends(get_config_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not config_db:
        raise HTTPException(status_code=503, detail="Configuration database is not configured")

    config = await request.json()
    save_project_config(config_db, project_id, config)
    return JSONResponse({"message": "Project configuration saved successfully."})


@router.post("/creative-projects/config/bulk", tags=["Creative Projects"])
async def save_bulk_project_configs_endpoint(request: Request, user: dict = Depends(get_user), config_db: firestore.Client = Depends(get_config_db)):
    if not user or user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="Permission denied")
    if not config_db:
        raise HTTPException(status_code=503, detail="Configuration database is not configured")

    configs = await request.json()
    print(f"configs : {configs}")
    save_bulk_project_configs(config_db, configs)
    return JSONResponse({"message": "Project configurations saved successfully."})


@router.post("/creative-projects/{project_id}/assets", tags=["Creative Projects"])
async def add_asset_to_project(project_id: str, request: Request, user: dict = Depends(get_user), creative_projects_db: firestore.Client = Depends(get_creative_projects_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not creative_projects_db:
        raise HTTPException(status_code=503, detail="Creative projects database is not configured")

    body = await request.json()
    asset_data = body.get("asset")

    if not asset_data:
        raise HTTPException(status_code=400, detail="Asset data is required.")

    project_ref = creative_projects_db.collection('projects').document(project_id)
    project_doc = project_ref.get()
    if not project_doc.exists:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project_members = project_doc.to_dict().get('members', [])
    if user.get('email') not in project_members and user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="You are not a member of this project.")

    asset_ref = project_ref.collection('assets').document()
    asset_payload = {
        "added_by": user.get("email"),
        "added_at": firestore.SERVER_TIMESTAMP,
        **asset_data
    }
    asset_ref.set(asset_payload)
    
    return JSONResponse({"message": "Asset added to project successfully", "id": asset_ref.id}, status_code=201)


@router.get("/creative-projects/{project_id}/assets", tags=["Creative Projects"])
def get_project_assets(project_id: str, user: dict = Depends(get_user), creative_projects_db: firestore.Client = Depends(get_creative_projects_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not creative_projects_db:
        raise HTTPException(status_code=503, detail="Creative projects database is not configured")

    project_ref = creative_projects_db.collection('projects').document(project_id)
    project_doc = project_ref.get()
    if not project_doc.exists:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project_members = project_doc.to_dict().get('members', [])
    if user.get('email') not in project_members and user.get('role') != 'APP_ADMIN':
        raise HTTPException(status_code=403, detail="You are not a member of this project.")

    assets_ref = project_ref.collection('assets').order_by('added_at', direction=firestore.Query.DESCENDING)
    assets = []
    veo_client = VeoApiClient(settings.PROJECT_ID, settings.LOCATION, settings.VIDEO_BUCKET_NAME)
    for doc in assets_ref.stream():
        asset_data = doc.to_dict()
        asset_data["id"] = doc.id
        if 'added_at' in asset_data and hasattr(asset_data['added_at'], 'isoformat'):
            asset_data['added_at'] = asset_data['added_at'].isoformat()
        
        asset_type = asset_data.get('type')
        gcs_uri = None

        if asset_type == 'image':
            gcs_uri = asset_data.get('gcs_uri') or asset_data.get('output_image_gcs_path')
        else:
            asset_data['type'] = 'video'
            gcs_uri = asset_data.get('gcs_uri')
            if not gcs_uri:
                gcs_paths_str = asset_data.get("output_video_gcs_paths", "[]")
                try:
                    gcs_paths = json.loads(gcs_paths_str)
                    if gcs_paths:
                        gcs_uri = gcs_paths[0]
                except (json.JSONDecodeError, TypeError):
                    pass
        
        if gcs_uri:
            asset_data['signed_url'] = veo_client.generate_signed_gcs_url(gcs_uri)
        else:
            asset_data['signed_url'] = None
        
        assets.append(asset_data)

    return JSONResponse(assets)


@router.post("/groups/import", tags=["Groups"])
async def import_groups(request: Request, user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db)):
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

            query = groups_db.collection('groups').where(filter=FieldFilter("name", "==", group_name)).limit(1)
            existing_groups = list(query.stream())

            if existing_groups:
                group_ref = existing_groups[0].reference
                group_ref.update({"members": firestore.ArrayUnion(members)})
            else:
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


@router.post("/videos/share", tags=["Sharing"])
async def share_video(request: Request, user: dict = Depends(get_user), shared_videos_db: firestore.Client = Depends(get_shared_videos_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not shared_videos_db:
        raise HTTPException(status_code=503, detail="Shared videos database is not configured")

    body = await request.json()
    video_data = body.get("video")
    group_id = body.get("group_id")

    if not video_data or not group_id:
        raise HTTPException(status_code=400, detail="Video data and group_id are required.")

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

    doc_ref = shared_videos_db.collection(settings.SHARED_VIDEOS_COLLECTION).document()
    
    shared_video_payload = {
        "gcs_uri": gcs_uri,
        "shared_with_group_id": group_id,
        "shared_by_user_email": user.get("email"),
        "shared_at": firestore.SERVER_TIMESTAMP,
        "prompt": video_data.get("prompt"),
        "user_email": video_data.get("user_email"), 
        "trigger_time": video_data.get("trigger_time"),
        "completion_time": video_data.get("completion_time"),
        "operation_duration": video_data.get("operation_duration"),
        "status": video_data.get("status"),
        "model_used": video_data.get("model_used"),
        "resolution": video_data.get("resolution"),
    }
    
    shared_video_payload = {k: v for k, v in shared_video_payload.items() if v is not None}

    doc_ref.set(shared_video_payload)
    
    return JSONResponse({"message": "Shared successfully", "id": doc_ref.id}, status_code=201)


@router.post("/images/share", tags=["Sharing"])
async def share_image(request: Request, user: dict = Depends(get_user), shared_videos_db: firestore.Client = Depends(get_shared_videos_db)):
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

    doc_ref = shared_videos_db.collection(settings.SHARED_VIDEOS_COLLECTION).document()
    
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


@router.get("/groups/{group_id}/items", tags=["Sharing"])
def get_shared_items(group_id: str, user: dict = Depends(get_user), groups_db: firestore.Client = Depends(get_groups_db), shared_videos_db: firestore.Client = Depends(get_shared_videos_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not groups_db or not shared_videos_db:
        raise HTTPException(status_code=503, detail="Database services are not configured")

    group_ref = groups_db.collection('groups').document(group_id)
    group = group_ref.get()
    if not group.exists or user.get('email') not in group.to_dict().get('members', []):
        raise HTTPException(status_code=403, detail="Permission denied")

    items_ref = shared_videos_db.collection(settings.SHARED_VIDEOS_COLLECTION).where(filter=FieldFilter('shared_with_group_id', '==', group_id)).order_by('shared_at', direction=firestore.Query.DESCENDING)
    
    items = []
    veo_client = VeoApiClient(settings.PROJECT_ID, settings.LOCATION, settings.VIDEO_BUCKET_NAME)
    
    for doc in items_ref.stream():
        item_data = doc.to_dict()
        item_data["id"] = doc.id
        
        if 'shared_at' in item_data and hasattr(item_data['shared_at'], 'isoformat'):
            item_data['shared_at'] = item_data['shared_at'].isoformat()
        
        gcs_uri = item_data.get('gcs_uri') or item_data.get('video_gcs_uri')
        if gcs_uri:
            item_data['signed_url'] = veo_client.generate_signed_gcs_url(gcs_uri)
        
        items.append(item_data)

    return JSONResponse(items)


@router.delete("/shared-items/{shared_item_id}", tags=["Sharing"])
def delete_shared_item(shared_item_id: str, user: dict = Depends(get_user), shared_videos_db: firestore.Client = Depends(get_shared_videos_db)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not shared_videos_db:
        raise HTTPException(status_code=503, detail="Shared items database is not configured")

    doc_ref = shared_videos_db.collection(settings.SHARED_VIDEOS_COLLECTION).document(shared_item_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Shared item not found")

    if doc.to_dict().get("shared_by_user_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only delete items you have shared.")

    doc_ref.delete()
    return JSONResponse({"message": "Shared item deleted successfully"})


@router.get("/analytics/consumption", tags=["Analytics"])
def get_consumption_analytics(
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_x: Optional[int] = 10,
    bq_client: bigquery.Client = Depends(get_bq_client),
    generation_service: GenerationService = Depends(get_generation_service)
):
    """
    Provides aggregated consumption data for both video and image generation.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    cost_managers = settings.COST_MANAGERS
    if user.get('email') not in cost_managers:
        raise HTTPException(status_code=403, detail="You do not have permission to view analytics.")

    if not settings.ENABLE_BIGQUERY_LOGGING or not bq_client:
        raise HTTPException(status_code=501, detail="Analytics are disabled (BigQuery not configured).")

    def calculate_video_cost(model_used: str, video_duration: float, with_audio: Optional[bool]) -> float:
        if not model_used or not video_duration: return 0.0
        model_info = next((m for m in get_models_config().get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        cost_per_second = pricing.get('video_with_audio') if with_audio else pricing.get('video_without_audio', 0.0)
        return round(video_duration * cost_per_second, 4)

    def calculate_image_cost(model_used: str) -> float:
        if not model_used: return 0.0
        model_info = next((m for m in get_image_models().get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        return round(pricing.get('per_image', 0.0), 4)

    try:
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
            FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.HISTORY_TABLE}`
            WHERE {" AND ".join(video_where_clauses)}
        """
        image_query = f"""
            SELECT trigger_time, user_email, model_used
            FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.imagen_history`
            WHERE {" AND ".join(image_where_clauses)}
        """
        job_config = bigquery.QueryJobConfig(query_parameters=query_params)

        video_rows = bq_client.query(video_query, job_config=job_config).result()
        image_rows = bq_client.query(image_query, job_config=job_config).result()

        daily_costs = {}
        user_costs = {}

        for row in video_rows:
            cost = calculate_video_cost(row.model_used, row.video_duration, row.with_audio)
            if cost > 0:
                consumption_date = row.trigger_time.strftime('%Y-%m-%d')
                date_entry = daily_costs.setdefault(consumption_date, {'video': 0, 'image': 0})
                date_entry['video'] += cost

                user_entry = user_costs.setdefault(row.user_email, {'video': 0, 'image': 0})
                user_entry['video'] += cost
        
        for row in image_rows:
            cost = calculate_image_cost(row.model_used)
            if cost > 0:
                consumption_date = row.trigger_time.strftime('%Y-%m-%d')
                date_entry = daily_costs.setdefault(consumption_date, {'video': 0, 'image': 0})
                date_entry['image'] += cost

                user_entry = user_costs.setdefault(row.user_email, {'video': 0, 'image': 0})
                user_entry['image'] += cost

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
        )[:top_x]

        video_dist_query = f"SELECT model_used, with_audio, COUNT(*) as generation_count FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.HISTORY_TABLE}` WHERE {' AND '.join(video_where_clauses)} AND model_used LIKE 'veo-%' GROUP BY model_used, with_audio"
        image_dist_query = f"SELECT model_used, COUNT(*) as generation_count FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.imagen_history` WHERE {' AND '.join(image_where_clauses)} GROUP BY model_used"
        
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


@router.get("/analytics/consumption_by_project", tags=["Analytics"])
def get_consumption_by_project_analytics(
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    bq_client: bigquery.Client = Depends(get_bq_client),
    generation_service: GenerationService = Depends(get_generation_service),
    creative_projects_db: firestore.Client = Depends(get_creative_projects_db)
):
    """
    Provides aggregated consumption data grouped by creative project.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    cost_managers = settings.COST_MANAGERS
    if user.get('email') not in cost_managers:
        raise HTTPException(status_code=403, detail="You do not have permission to view analytics.")

    if not settings.ENABLE_BIGQUERY_LOGGING or not bq_client:
        raise HTTPException(status_code=501, detail="Analytics are disabled (BigQuery not configured).")

    def calculate_video_cost(model_used: str, video_duration: float, with_audio: Optional[bool]) -> float:
        if not model_used or not video_duration: return 0.0
        model_info = next((m for m in get_models_config().get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        cost_per_second = pricing.get('video_with_audio') if with_audio else pricing.get('video_without_audio', 0.0)
        return round(video_duration * cost_per_second, 4)

    def calculate_image_cost(model_used: str) -> float:
        if not model_used: return 0.0
        model_info = next((m for m in get_image_models().get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        return round(pricing.get('per_image', 0.0), 4)

    try:
        query_params = []
        video_where_clauses = ["status = 'SUCCESS'", "video_duration > 0", "creative_project_id IS NOT NULL"]
        image_where_clauses = ["status = 'SUCCESS'", "creative_project_id IS NOT NULL"]

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
            SELECT creative_project_id, model_used, video_duration, with_audio
            FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.HISTORY_TABLE}`
            WHERE {" AND ".join(video_where_clauses)}
        """
        image_query = f"""
            SELECT creative_project_id, model_used
            FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.imagen_history`
            WHERE {" AND ".join(image_where_clauses)}
        """
        job_config = bigquery.QueryJobConfig(query_parameters=query_params)

        video_rows = bq_client.query(video_query, job_config=job_config).result()
        image_rows = bq_client.query(image_query, job_config=job_config).result()

        project_costs = {}

        for row in video_rows:
            cost = calculate_video_cost(row.model_used, row.video_duration, row.with_audio)
            if cost > 0:
                project_entry = project_costs.setdefault(row.creative_project_id, {'video': 0, 'image': 0})
                project_entry['video'] += cost
        
        for row in image_rows:
            cost = calculate_image_cost(row.model_used)
            if cost > 0:
                project_entry = project_costs.setdefault(row.creative_project_id, {'video': 0, 'image': 0})
                project_entry['image'] += cost
        
        project_details = {}
        if creative_projects_db and project_costs:
            project_ids = list(project_costs.keys())
            project_refs = [creative_projects_db.collection('projects').document(pid) for pid in project_ids]
            project_docs = creative_projects_db.get_all(project_refs)
            for doc in project_docs:
                if doc.exists:
                    project_details[doc.id] = doc.to_dict().get('name', 'Unknown Project')

        project_consumption_data = [
            {
                "project_id": pid,
                "project_name": project_details.get(pid, "Unknown Project"),
                "video_cost": round(costs['video'], 2),
                "image_cost": round(costs['image'], 2),
                "total_cost": round(costs['video'] + costs['image'], 2)
            }
            for pid, costs in project_costs.items()
        ]

        return JSONResponse({
            "project_consumption": sorted(project_consumption_data, key=lambda x: x['total_cost'], reverse=True)
        })

    except Exception as e:
        logger.error(f"Failed to execute project consumption analytics query. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve project consumption analytics data.")


@router.get("/analytics/top_users", tags=["Analytics"])
def get_top_users_analytics(
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_x: Optional[int] = 10,
    bq_client: bigquery.Client = Depends(get_bq_client),
    generation_service: GenerationService = Depends(get_generation_service)
):
    """
    Provides aggregated consumption data for the top X users.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    cost_managers = settings.COST_MANAGERS
    if user.get('email') not in cost_managers:
        raise HTTPException(status_code=403, detail="You do not have permission to view analytics.")

    if not settings.ENABLE_BIGQUERY_LOGGING or not bq_client:
        raise HTTPException(status_code=501, detail="Analytics are disabled (BigQuery not configured).")

    def calculate_video_cost(model_used: str, video_duration: float, with_audio: Optional[bool]) -> float:
        if not model_used or not video_duration: return 0.0
        model_info = next((m for m in get_models_config().get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        cost_per_second = pricing.get('video_with_audio') if with_audio else pricing.get('video_without_audio', 0.0)
        return round(video_duration * cost_per_second, 4)

    def calculate_image_cost(model_used: str) -> float:
        if not model_used: return 0.0
        model_info = next((m for m in get_image_models().get('models', []) if m['id'] == model_used), None)
        if not model_info: return 0.0
        pricing = model_info.get('pricing', {})
        return round(pricing.get('per_image', 0.0), 4)

    try:
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
            SELECT user_email, model_used, video_duration, with_audio
            FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.HISTORY_TABLE}`
            WHERE {" AND ".join(video_where_clauses)}
        """
        image_query = f"""
            SELECT user_email, model_used
            FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.imagen_history`
            WHERE {" AND ".join(image_where_clauses)}
        """
        job_config = bigquery.QueryJobConfig(query_parameters=query_params)

        video_rows = bq_client.query(video_query, job_config=job_config).result()
        image_rows = bq_client.query(image_query, job_config=job_config).result()

        user_costs = {}
        for row in video_rows:
            cost = calculate_video_cost(row.model_used, row.video_duration, row.with_audio)
            if cost > 0:
                user_entry = user_costs.setdefault(row.user_email, {'video': 0, 'image': 0})
                user_entry['video'] += cost
        
        for row in image_rows:
            cost = calculate_image_cost(row.model_used)
            if cost > 0:
                user_entry = user_costs.setdefault(row.user_email, {'video': 0, 'image': 0})
                user_entry['image'] += cost

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
        )[:top_x]

        return JSONResponse(top_users_chart_data)

    except Exception as e:
        logger.error(f"Failed to execute top users analytics query. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve top users analytics data.")

@router.post("/generate-prompt-from-images", tags=["Prompt Generation"])
async def generate_prompt_from_images(
    character_image: Optional[UploadFile] = File(None),
    background_image: Optional[UploadFile] = File(None),
    prop_image: Optional[UploadFile] = File(None)
):
    if not character_image and not background_image and not prop_image:
        raise HTTPException(status_code=400, detail="At least one image must be provided.")

    try:
        client = genai.Client(vertexai=True, project=settings.PROJECT_ID, location=settings.LOCATION)
        
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


@router.post("/translate", tags=["Translation"])
async def translate_text_endpoint(request: Request, user: dict = Depends(get_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    body = await request.json()
    text = body.get("text")
    target_language = body.get("target_language")

    if not text or not target_language:
        raise HTTPException(status_code=400, detail="Text and target_language are required.")

    try:
        genai_client = genai.Client(vertexai=True, project=settings.PROJECT_ID, location=settings.LOCATION)
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
            config=types.GenerateContentConfig(
                temperature=0.2,
                top_p=0.95,
                max_output_tokens=1024,
            )
        )
        return JSONResponse({"translated_text": response.text})
    except Exception as e:
        logger.error(f"Translation failed. Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")
