import yaml
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from pathlib import Path


class QuotaSettings(BaseModel):
    type: str = "NO_LIMIT"
    limit: Optional[int] = None
    period: Optional[str] = "day"


class AppConfig(BaseModel):
    PROJECT_ID: str
    LOCATION: str
    VIDEO_BUCKET_NAME: str
    ANALYSIS_DATASET: str
    HISTORY_TABLE: str
    IMAGEN_HISTORY_TABLE: str
    IMAGE_ENRICHMENT_HISTORY_TABLE: str
    PROMPT_GALLERY_COLLECTION: str
    PROMPT_GALLERY_DB: str
    CONFIG_DB: str
    GROUPS_DB: str
    CREATIVE_PROJECTS_DB: str
    SHARED_VIDEOS_DB: str
    SHARED_VIDEOS_COLLECTION: str
    SECRET_ID: str
    ENABLE_OAUTH: bool = False
    ALLOWED_DOMAINS: List[str] = []
    APP_ADMINS: List[str] = []
    COST_MANAGERS: List[str] = []
    FRONTEND_URL: str
    REDIRECT_URI: str
    ENABLE_BIGQUERY_LOGGING: bool = False
    GEMINI_MODEL: str = "veo-2.0-generate-001"
    BANNER_MESSAGES: List[str] = []
    ENABLE_UPSCALE: bool = False
    quota: QuotaSettings = Field(default_factory=QuotaSettings)


def load_config() -> AppConfig:
    config_path = Path(__file__).parent.parent / 'configs' / 'app-config.yaml'
    with open(config_path, 'r') as config_file:
        config_data = yaml.safe_load(config_file)
    return AppConfig(**config_data)


settings = load_config()
