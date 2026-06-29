import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings
from app.services import system_service
from app.services.ollama_client import ollama_client

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: str
    app: str
    version: str


class OllamaHealthResponse(BaseModel):
    status: str
    ollama_url: str
    available: bool
    models: list[str]


@router.get("", response_model=HealthResponse, summary="Backend health check")
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
    )


@router.get("/ollama", response_model=OllamaHealthResponse, summary="Ollama connectivity check")
async def ollama_health() -> OllamaHealthResponse:
    available = await ollama_client.is_available()

    model_names: list[str] = []
    if available:
        try:
            models = await ollama_client.list_models()
            model_names = sorted(
                filter(None, (m.get("name") or m.get("model") or "" for m in models))
            )
        except Exception:
            pass

    return OllamaHealthResponse(
        status="ok" if available else "unavailable",
        ollama_url=settings.OLLAMA_BASE_URL,
        available=available,
        models=model_names,
    )


class SystemInfoResponse(BaseModel):
    specs: dict
    models: list[dict]
    recommended: str | None


@router.get("/system", response_model=SystemInfoResponse, summary="PC specs + per-model efficiency")
async def system_info() -> SystemInfoResponse:
    """
    Local hardware snapshot plus an efficiency score (1-10) for each installed
    Ollama model, and the single best model to run on this PC. Powers the model
    picker's efficiency column and the "Best for your PC" box.
    """
    specs = await asyncio.to_thread(system_service.get_specs)

    raw_models: list[dict] = []
    if await ollama_client.is_available():
        try:
            raw_models = await ollama_client.list_models()
        except Exception:
            raw_models = []

    scored = system_service.score_models(raw_models, specs)
    return SystemInfoResponse(
        specs=specs,
        models=scored,
        recommended=system_service.recommend(scored),
    )
