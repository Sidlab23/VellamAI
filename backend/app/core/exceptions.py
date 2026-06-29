from fastapi import Request
from fastapi.responses import JSONResponse


class VellamError(Exception):
    """Base exception for all application errors."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class TaskNotFoundError(VellamError):
    def __init__(self, task_id: str):
        super().__init__(f"Task '{task_id}' not found", status_code=404)


class TaskStateError(VellamError):
    def __init__(self, message: str):
        super().__init__(message, status_code=409)


class OllamaConnectionError(VellamError):
    def __init__(self, detail: str = "Cannot reach Ollama at localhost:11434"):
        super().__init__(detail, status_code=503)


class OllamaModelError(VellamError):
    def __init__(self, model: str):
        super().__init__(f"Ollama model '{model}' is not available", status_code=422)


class AgentError(VellamError):
    def __init__(self, message: str):
        super().__init__(message, status_code=500)


class ApprovalRequiredError(VellamError):
    """Raised when an agent action requires human approval before proceeding."""

    def __init__(self, action: str, details: str = ""):
        super().__init__(
            f"Action '{action}' requires user approval. {details}".strip(),
            status_code=202,
        )
        self.action = action
        self.details = details


# --- FastAPI exception handlers ---

async def vellam_exception_handler(request: Request, exc: VellamError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": type(exc).__name__, "message": exc.message},
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"error": "InternalServerError", "message": str(exc)},
    )
