from google.cloud import firestore
import yaml

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

def get_models_config():
    """
    Retrieves the models from the models.yaml file.
    """
    try:
        with open('./models.yaml', 'r') as f:
            return yaml.safe_load(f)
    except (FileNotFoundError, yaml.YAMLError):
        return {"models": []}

def get_image_models():
    """
    Retrieves the image models from the image-models.yaml file.
    """
    try:
        with open('./image-models.yaml', 'r') as f:
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
