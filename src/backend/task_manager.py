import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Callable

# ==============================================================================
# 1. In-Memory Task Store
# ==============================================================================

# Using a simple dictionary for in-memory task tracking.
# In a production environment, consider a more persistent store like Redis or a database.
_task_store: Dict[str, Dict[str, Any]] = {}
_executor = ThreadPoolExecutor(max_workers=4) # Adjust max_workers as needed

# ==============================================================================
# 2. Task Management Functions
# ==============================================================================

def create_task(target_func: Callable, *args, **kwargs) -> str:
    """
    Submits a function to the thread pool and returns a unique task ID.
    """
    task_id = str(uuid.uuid4())
    
    def task_wrapper(task_id: str):
        """
        A wrapper to update the task store with the result or an error.
        """
        try:
            result = target_func(*args, **kwargs)
            _task_store[task_id] = {"status": "completed", "result": result}
        except Exception as e:
            _task_store[task_id] = {"status": "failed", "error": str(e)}

    # Submit the wrapped function to the executor
    _executor.submit(task_wrapper, task_id)
    
    # Immediately store the initial status
    _task_store[task_id] = {"status": "running"}
    
    return task_id

def get_task_status(task_id: str) -> Dict[str, Any]:
    """
    Retrieves the status of a task from the in-memory store.
    """
    return _task_store.get(task_id, {"status": "not_found"})
