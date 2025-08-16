from pydantic import BaseModel, Field
from typing import Optional, List

class VideoGenerationRequest(BaseModel):
    prompt: str
    model: Optional[str] = "veo-2.0-generate-001"
    aspectRatio: Optional[str] = "16:9"
    duration: Optional[int] = 8
    sampleCount: Optional[int] = 1
    image_gcs_uri: Optional[str] = None
    final_frame_gcs_uri: Optional[str] = None
    generateAudio: Optional[bool] = False
    enhancePrompt: Optional[bool] = True
    extend_duration: Optional[int] = None
    resolution: Optional[str] = None
    creative_project_id: Optional[str] = None

class ImageGenerationRequest(BaseModel):
    prompt: str
    model: Optional[str] = "imagen-3.0-generate-001"
    negative_prompt: Optional[str] = None
    aspect_ratio: Optional[str] = "1:1"
    sample_count: Optional[int] = 1
    image_size: Optional[str] = "1024x1024"
    creative_project_id: Optional[str] = None

class TaskResponse(BaseModel):
    task_id: str

class VideoData(BaseModel):
    gcs_uri: str
    signed_url: str

class ImageData(BaseModel):
    gcs_uri: str
    signed_url: str

class RaiReason(BaseModel):
    code: str
    category: str
    description: str
    filtered: str

class VideoGenerationResult(BaseModel):
    message: str
    videos: List[VideoData]
    duration: float
    revisedPrompt: Optional[str] = None
    rai_reasons: Optional[List[RaiReason]] = None

class ImageGenerationResult(BaseModel):
    message: str
    images: List[ImageData]
    duration: float
    prompt: str
    model_used: str
    resolution: str
    rai_reasons: Optional[List[RaiReason]] = None

class ImageImitationResult(BaseModel):
    message: str
    images: List[ImageData]
    duration: float
    revised_prompt: str
    model: str
    resolution: str
    rai_reasons: Optional[List[RaiReason]] = None

class TaskStatus(BaseModel):
    status: str
    result: Optional[dict] = None
    error: Optional[str] = None
