import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Callable, Optional
import logging

logger = logging.getLogger(__name__)

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

def create_task(
    target_func: Callable,
    on_success: Optional[Callable] = None,
    on_error: Optional[Callable] = None,
    *args,
    **kwargs
) -> str:
    """
    Submits a function to the thread pool, returning a task ID.
    Executes on_success or on_error callbacks upon completion.
    """
    task_id = str(uuid.uuid4())
    logger.info(f"Creating task {task_id} for function: {target_func.__name__}")

    # Extract original kwargs for the target function, separating them from callback args
    # This assumes that the callbacks will get their arguments from the result/error
    # and the shared context passed in kwargs.
    func_kwargs = kwargs.copy()

    def task_wrapper(task_id: str):
        """
        A wrapper to execute the target function and handle callbacks.
        """
        logger.info(f"Task {task_id} started.")
        try:
            # Pass only the relevant kwargs to the target function
            result = target_func(*args, **func_kwargs)
            _task_store[task_id] = {"status": "completed", "result": result}
            logger.info(f"Task {task_id} completed successfully.")
            if on_success:
                try:
                    logger.info(f"Executing on_success callback for task {task_id}.")
                    # Pass the result and the original context to the callback
                    on_success(result, **func_kwargs)
                except Exception as cb_e:
                    logger.error(f"Error in on_success callback for task {task_id}: {cb_e}", exc_info=True)
        except Exception as e:
            _task_store[task_id] = {"status": "failed", "error": str(e)}
            logger.error(f"Task {task_id} failed with error: {e}", exc_info=True)
            if on_error:
                try:
                    logger.info(f"Executing on_error callback for task {task_id}.")
                    # Pass the error and the original context to the callback
                    on_error(e, **func_kwargs)
                except Exception as cb_e:
                    logger.error(f"Error in on_error callback for task {task_id}: {cb_e}", exc_info=True)

    # Submit the wrapped function to the executor
    _executor.submit(task_wrapper, task_id)
    
    # Immediately store the initial status
    _task_store[task_id] = {"status": "running"}
    logger.info(f"Task {task_id} is now running.")
    
    return task_id

def get_task_status(task_id: str) -> Dict[str, Any]:
    """
    Retrieves the status of a task from the in-memory store.
    """
    return _task_store.get(task_id, {"status": "not_found"})
