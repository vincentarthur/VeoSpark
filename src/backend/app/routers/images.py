from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Request
from app.schemas import ImageGenerationRequest, TaskResponse
from app.services import GenerationService, get_generation_service
from app.config import settings
from app.dependencies import get_bq_client, get_config_db, get_creative_projects_db, get_shared_videos_db
from app.video_processing import check_quota
from app.config_manager import get_project_config, get_config
from google.cloud import bigquery, firestore
from app.dependencies import get_user
from app.services import VeoApiClient
import logging
from datetime import datetime, timezone, timedelta
from app.task_manager import create_task
from typing import Optional, List
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
        on_error=lambda e, **kwargs: generation_service.on_generation_error(e, asset_type="imgen", **kwargs),
        prompt=request.prompt,
        user_info=user,
        body=request.dict(),
        trigger_time=datetime.now(timezone.utc)
    )
    logger.info(f"Task {task_id} created for image generation.")
    return TaskResponse(task_id=task_id)

@router.post("/enrich", response_model=TaskResponse)
async def enrich_image(
    user: dict = Depends(get_user),
    files: Optional[List[UploadFile]] = File(None),
    previous_image_gcs_paths: Optional[List[str]] = Form(None),
    sub_prompt: str = Form(""),
    model: str = Form(...),
    sample_count: int = Form(1),
    aspect_ratio: str = Form("1:1"),
    creative_project_id: Optional[str] = Form(None),
    conversation_history: Optional[str] = Form(None),
    generation_service: GenerationService = Depends(get_generation_service),
    bq_client: bigquery.Client = Depends(get_bq_client),
    config_db: firestore.Client = Depends(get_config_db)
):
    if settings.ENABLE_OAUTH and not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_email = user.get('email', 'anonymous') if user else 'anonymous'
    logger.info(f"Received image enrichment request from user: {user_email} with sub_prompt: '{sub_prompt[:50]}...'")

    if not files and not previous_image_gcs_paths:
        raise HTTPException(status_code=400, detail="Either image files or previous_image_gcs_paths must be provided.")

    if files:
        if len(files) > 3:
            raise HTTPException(status_code=400, detail="You can upload a maximum of 3 images.")
        for file in files:
            if not file.content_type.startswith("image/"):
                logger.error(f"Validation Error: Invalid file type '{file.content_type}'. Only images are allowed.")
                raise HTTPException(status_code=400, detail="Invalid file type. Only images are allowed.")

    project_config = get_project_config(config_db, creative_project_id) if creative_project_id else None
    quota_exceeded, message = check_quota(user_email, bq_client, get_config(config_db), settings.dict(), creative_project_id, project_config)
    if quota_exceeded:
        logger.warning(f"Quota exceeded for user {user_email}: {message}")
        raise HTTPException(status_code=429, detail=message)

    task_kwargs = {
        "user_info": user,
        "sub_prompt": sub_prompt,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "creative_project_id": creative_project_id,
        "conversation_history": json.loads(conversation_history) if conversation_history else None,
        "trigger_time": datetime.now(timezone.utc)
    }

    if files:
        task_kwargs["files"] = []
        for file in files:
            task_kwargs["files"].append({
                "file_bytes": await file.read(),
                "file_content_type": file.content_type,
                "file_filename": file.filename
            })
    elif previous_image_gcs_paths:
        task_kwargs["previous_image_gcs_paths"] = previous_image_gcs_paths

    logger.info("Submitting image enrichment task to the background processor.")
    task_id = create_task(
        generation_service.enrich_image,
        on_success=generation_service.on_image_enrichment_success,
        on_error=lambda e, **kwargs: generation_service.on_generation_error(e, asset_type="image_enrichment", **kwargs),
        **task_kwargs
    )
    logger.info(f"Task {task_id} created for image enrichment.")
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
            creative_project_id,
            aspect_ratio
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


@router.get("/enrichment-history")
def get_image_enrichment_history(
    user: dict = Depends(get_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
    model: Optional[str] = None,
    page: int = 1,
    page_size: int = 10,
    bq_client: bigquery.Client = Depends(get_bq_client)
):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not settings.ENABLE_BIGQUERY_LOGGING or not bq_client:
        raise HTTPException(status_code=501, detail="History feature is disabled.")

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

    where_sql = " AND ".join(where_clauses)
    
    count_query = f"""
        SELECT COUNT(*) as total_rows
        FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.IMAGE_ENRICHMENT_HISTORY_TABLE}`
        WHERE {where_sql}
    """
    
    job_config = bigquery.QueryJobConfig(query_parameters=query_params)
    count_job = bq_client.query(count_query, job_config=job_config)
    total_rows = next(count_job.result()).total_rows

    query = f"""
        SELECT *
        FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.IMAGE_ENRICHMENT_HISTORY_TABLE}`
        WHERE {where_sql}
        ORDER BY trigger_time DESC
        LIMIT {page_size} OFFSET {(page - 1) * page_size}
    """
    
    query_job = bq_client.query(query, job_config=job_config)
    rows = [dict(row) for row in query_job.result()]

    veo_client = VeoApiClient(settings.PROJECT_ID, settings.LOCATION, settings.VIDEO_BUCKET_NAME)
    for row in rows:
        if 'trigger_time' in row and row['trigger_time']:
            row['trigger_time'] = row['trigger_time'].isoformat()
        if 'completion_time' in row and row['completion_time']:
            row['completion_time'] = row['completion_time'].isoformat()
        
        gcs_uri = row.get('output_image_gcs_path')
        if gcs_uri:
            row['signed_url'] = veo_client.generate_signed_gcs_url(gcs_uri)

    return JSONResponse({"rows": rows, "total": total_rows})


@router.post("/search_similarity_image")
async def search_similarity_image(
    request: Request,
    user: dict = Depends(get_user),
    bq_client: bigquery.Client = Depends(get_bq_client),
    creative_projects_db: firestore.Client = Depends(get_creative_projects_db)
):
    body = await request.json()
    text = body.get("text")

    user_email = user.get('email')
    
    # Utilize FindSimilarImage_{TABLE_NAME} function to retrieve images
    # Define the query with named parameters (@param_name)
    parameterized_sql_query = f"""
        SELECT
            *
        FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.FIND_SIMILAR_IMAGES_IMAGEN_HISTORY}`(
            @query_text,
            @user_email,
            @top_k
        )
    """

    # Define the job configuration with the parameters
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("query_text", "STRING", text),
            bigquery.ScalarQueryParameter("user_email", "STRING", user_email),
            bigquery.ScalarQueryParameter("top_k", "INT64", settings.FIND_SIMILAR_TOP_K),
        ]
    )

    try:
        # Execute the query with the configuration
        query_job = bq_client.query(parameterized_sql_query, job_config=job_config)
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
            if 'trigger_time' in row and row['trigger_time'] and isinstance(row['trigger_time'], datetime):
                row['trigger_time'] = row['trigger_time'].isoformat()
            if 'completion_time' in row and row['completion_time'] and isinstance(row['completion_time'], datetime):
                row['completion_time'] = row['completion_time'].isoformat()

        return JSONResponse({"rows": rows, "total": len(rows)})

    except Exception as e:
        logger.error(f"Error of searching similar images from history for user {user_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to search most similar images from image history.")


@router.post("/search_similarity_image_enrich")
async def search_similarity_image_enrich(
    request: Request,
    user: dict = Depends(get_user),
    bq_client: bigquery.Client = Depends(get_bq_client),
    creative_projects_db: firestore.Client = Depends(get_creative_projects_db)
):
    body = await request.json()
    text = body.get("text")

    user_email = user.get('email')
    
    # Utilize FindSimilarImage_{TABLE_NAME} function to retrieve images
    # Define the query with named parameters (@param_name)
    parameterized_sql_query = f"""
        SELECT
            *
        FROM `{settings.PROJECT_ID}.{settings.ANALYSIS_DATASET}.{settings.FIND_SIMILAR_IMAGES_IMAGE_ENRICHMENT_HISTORY}`(
            @query_text,
            @user_email,
            @top_k
        )
    """

    # Define the job configuration with the parameters
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("query_text", "STRING", text),
            bigquery.ScalarQueryParameter("user_email", "STRING", user_email),
            bigquery.ScalarQueryParameter("top_k", "INT64", settings.FIND_SIMILAR_TOP_K),
        ]
    )

    try:
        # Execute the query with the configuration
        query_job = bq_client.query(parameterized_sql_query, job_config=job_config)
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
            if 'trigger_time' in row and row['trigger_time'] and isinstance(row['trigger_time'], datetime):
                row['trigger_time'] = row['trigger_time'].isoformat()
            if 'completion_time' in row and row['completion_time'] and isinstance(row['completion_time'], datetime):
                row['completion_time'] = row['completion_time'].isoformat()

        return JSONResponse({"rows": rows, "total": len(rows)})

    except Exception as e:
        logger.error(f"Error of searching similar images from image enrichment history for user {user_email}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to search most similar images from image enrichment history.")
