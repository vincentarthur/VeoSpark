from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Request
from schemas import ImageGenerationRequest, TaskResponse
from services import GenerationService, get_generation_service
from config import settings
from dependencies import get_bq_client, get_config_db, get_creative_projects_db, get_shared_videos_db
from video_processing import check_quota
from config_manager import get_project_config, get_config
from google.cloud import bigquery, firestore
from dependencies import get_user
from services import VeoApiClient
import logging
from datetime import datetime, timezone, timedelta
from task_manager import create_task
from typing import Optional
from starlette.responses import JSONResponse
import json

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/generate", response_model=TaskResponse)
async def generate_image(
    request: ImageGenerationRequest,
    user: dict = Depends(get_user),
    generation_service: GenerationService = Depends(get_generation_service),
    bq_client: bigquery.Client = Depends(get_bq_client),
    config_db: firestore.Client = Depends(get_config_db)
):
    if settings.ENABLE_OAUTH and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    logger.info(f"Received image generation request from user: {user_email} with prompt: '{request.prompt[:50]}...'")

    project_id = request.creative_project_id
    project_config = get_project_config(config_db, project_id) if project_id else None
    quota_exceeded, message = check_quota(user_email, bq_client, get_config(config_db), settings.dict(), project_id, project_config)
    if quota_exceeded:
        logger.warning(f"Quota exceeded for user {user_email}: {message}")
        raise HTTPException(status_code=429, detail=message)

    logger.info("Submitting image generation task to the background processor.")
    task_id = create_task(
        generation_service.generate_image,
        on_success=generation_service.on_image_generation_success,
        on_error=generation_service.on_generation_error,
        prompt=request.prompt,
        user_info=user,
        body=request.dict(),
        trigger_time=datetime.now(timezone.utc)
    )
    logger.info(f"Task {task_id} created for image generation.")
    return TaskResponse(task_id=task_id)

@router.post("/imitate", response_model=TaskResponse)
async def imitate_image(
    user: dict = Depends(get_user),
    file: UploadFile = File(...),
    sub_prompt: str = Form(""),
    model: str = Form(...),
    sample_count: int = Form(1),
    image_size: str = Form("1K"),
    creative_project_id: Optional[str] = Form(None),
    generation_service: GenerationService = Depends(get_generation_service),
    bq_client: bigquery.Client = Depends(get_bq_client),
    config_db: firestore.Client = Depends(get_config_db)
):
    if settings.ENABLE_OAUTH and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    logger.info(f"Received image imitation request from user: {user_email} with sub_prompt: '{sub_prompt[:50]}...'")

    if not file.content_type.startswith("image/"):
        logger.error(f"Validation Error: Invalid file type '{file.content_type}'. Only images are allowed.")
        raise HTTPException(status_code=400, detail="Invalid file type. Only images are allowed.")

    project_config = get_project_config(config_db, creative_project_id) if creative_project_id else None
    quota_exceeded, message = check_quota(user_email, bq_client, get_config(config_db), settings.dict(), creative_project_id, project_config)
    if quota_exceeded:
        logger.warning(f"Quota exceeded for user {user_email}: {message}")
        raise HTTPException(status_code=429, detail=message)

    file_bytes = await file.read()
    
    logger.info("Submitting image imitation task to the background processor.")
    task_id = create_task(
        generation_service.imitate_image,
        on_success=generation_service.on_image_imitation_success,
        on_error=generation_service.on_generation_error,
        user_info=user,
        file_bytes=file_bytes,
        file_content_type=file.content_type,
        file_filename=file.filename,
        sub_prompt=sub_prompt,
        model=model,
        sample_count=sample_count,
        image_size=image_size,
        creative_project_id=creative_project_id,
        trigger_time=datetime.now(timezone.utc)
    )
    logger.info(f"Task {task_id} created for image imitation.")
    return TaskResponse(task_id=task_id)

@router.get("/history")
def get_image_history(
    request: Request,
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
    model: Optional[str] = None,
    page: int = 1,
    page_size: int = 10,
    bq_client: bigquery.Client = Depends(get_bq_client),
    creative_projects_db: firestore.Client = Depends(get_creative_projects_db)
):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not settings.ENABLE_BIGQUERY_LOGGING or not bq_client:
        logger.warning(f"Attempted to access image history for {user.get('email')} but BigQuery is disabled.")
        return JSONResponse({"rows": [], "total": 0}, status_code=200)

    user_email = user.get('email')
    
    query_params = [bigquery.ScalarQueryParameter("user_email", "STRING", user_email)]
    where_clauses = ["user_email = @user_email"]

    if start_date:
        where_clauses.append("trigger_time >= @start_date")
        query_params.append(bigquery.ScalarQueryParameter("start_date", "TIMESTAMP", start_date))
    if end_date:
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
        FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.imagen_history`
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
            status,
            resolution,
            creative_project_id
        FROM
            `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.imagen_history`
        WHERE {" AND ".join(where_clauses)} ORDER BY trigger_time DESC
        LIMIT {page_size} OFFSET {(page - 1) * page_size}
    """
    
    job_config = bigquery.QueryJobConfig(query_parameters=query_params)

    try:
        query_job = bq_client.query(query, job_config=job_config)
        rows = [dict(row) for row in query_job.result()]

        project_ids = {row['creative_project_id'] for row in rows if row.get('creative_project_id')}
        project_names = {}
        if creative_projects_db and project_ids:
            project_refs = [creative_projects_db.collection('projects').document(pid) for pid in project_ids]
            project_docs = creative_projects_db.get_all(project_refs)
            for doc in project_docs:
                if doc.exists:
                    project_names[doc.id] = doc.to_dict().get('name')

        veo_client = VeoApiClient(settings.PROJECT_ID, settings.LOCATION, settings.VIDEO_BUCKET_NAME)
        for row in rows:
            gcs_path = row.get("output_image_gcs_path")
            if gcs_path:
                row["signed_url"] = veo_client.generate_signed_gcs_url(gcs_path)
            if row.get('creative_project_id'):
                row['project_name'] = project_names.get(row['creative_project_id'])

        return JSONResponse({"rows": rows, "total": total_rows})

    except Exception as e:
        logger.error(f"Error querying image history for user {user_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve image history.")


@router.post("/share", tags=["Team Gallery"])
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

    gcs_uri = item_data.get('output_image_gcs_path')

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
        "type": "image",
    }
    
    shared_item_payload = {k: v for k, v in shared_item_payload.items() if v is not None}

    doc_ref.set(shared_item_payload)
    
    return JSONResponse({"message": "Shared successfully", "id": doc_ref.id}, status_code=201)
