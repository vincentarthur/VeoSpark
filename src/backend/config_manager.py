from google.cloud import firestore

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
