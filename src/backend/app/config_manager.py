from google.cloud import firestore
import yaml
from datetime import datetime
from functools import lru_cache
from pathlib import Path

CONFIG_COLLECTION = 'system_config'
CONFIG_DOCUMENT = 'quota_settings'

def get_config(db: firestore.Client):
    doc_ref = db.collection(CONFIG_COLLECTION).document(CONFIG_DOCUMENT)
    doc = doc_ref.get()
    if doc.exists:
        return doc.to_dict()
    return {'quota': {'type': 'NO_LIMIT'}}

def save_config(config: dict, db: firestore.Client):
    doc_ref = db.collection(CONFIG_COLLECTION).document(CONFIG_DOCUMENT)
    doc_ref.set(config)

@lru_cache(maxsize=2)
def get_models_config():
    """
    Retrieves the models from the models.yaml file.
    """
    try:
        config_path = Path(__file__).parent.parent / 'configs' / 'models.yaml'
        with open(config_path, 'r') as f:
            return yaml.safe_load(f)
    except (FileNotFoundError, yaml.YAMLError):
        return {"models": []}

@lru_cache(maxsize=2)
def get_image_models():
    """
    Retrieves the image models from the image-models.yaml file.
    """
    try:
        config_path = Path(__file__).parent.parent / 'configs' / 'image-models.yaml'
        with open(config_path, 'r') as f:
            return yaml.safe_load(f)
    except (FileNotFoundError, yaml.YAMLError):
        return {"models": []}

@lru_cache(maxsize=2)
def get_image_enrichment_models():
    """
    Retrieves the image enrichment models from the image-enrichment-models.yaml file.
    """
    try:
        config_path = Path(__file__).parent.parent / 'configs' / 'image-enrichment-models.yaml'
        with open(config_path, 'r') as f:
            return yaml.safe_load(f)
    except (FileNotFoundError, yaml.YAMLError):
        return {"models": []}

def get_project_config(db: firestore.Client, project_id: str):
    """
    Retrieves the configuration for a specific project.
    """
    if not project_id:
        return None
    doc_ref = db.collection('project_configs').document(project_id)
    doc = doc_ref.get()
    if doc.exists:
        return doc.to_dict()
    return None

def save_project_config(db: firestore.Client, project_id: str, config: dict):
    """
    Saves the configuration for a specific project.
    """
    if not project_id:
        return
    doc_ref = db.collection('project_configs').document(project_id)
    doc_ref.set(config)

def save_bulk_project_configs(db: firestore.Client, configs: list):
    """
    Saves multiple project configurations in a single batch.
    """
    batch = db.batch()
    for config in configs:
        project_id = config.get("project_id")
        if project_id:
            doc_ref = db.collection('project_configs').document(project_id)
            batch.set(doc_ref, config)
    batch.commit()

def get_price_for_model(model_id: str, usage_date: datetime, model_type: str):
    """
    Retrieves the correct pricing for a given model and usage date.
    """
    if model_type == 'image':
        config = get_image_models()
    elif model_type == 'image_enrichment':
        config = get_image_enrichment_models()
    else:
        config = get_models_config()

    models = config.get('models', [])
    for model in models:
        if model.get('id') == model_id:
            pricing_versions = model.get('pricing', [])
            # Sort pricing versions by effective_date in descending order
            pricing_versions.sort(key=lambda x: datetime.strptime(x['effective_date'], "%Y-%m-%d"), reverse=True)
            
            for price_info in pricing_versions:
                effective_date = datetime.strptime(price_info['effective_date'], "%Y-%m-%d")
                if usage_date.date() >= effective_date.date():
                    return price_info
    return None # Or a default price
