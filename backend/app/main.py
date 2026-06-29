from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.exceptions import (
    VellamError,
    vellam_exception_handler,
    generic_exception_handler,
)
from app.core.logging import get_logger, setup_logging
from app.database import close_db, init_db
from app.api.routes import health, tasks, agent, ws, debug, vault, profile
from app.services.ollama_client import ollama_client

setup_logging(log_level=settings.LOG_LEVEL, log_file=settings.LOG_FILE)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "startup",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        host=settings.HOST,
        port=settings.PORT,
    )
    await init_db()
    logger.info("database_ready")

    ollama_ok = await ollama_client.is_available()
    if ollama_ok:
        models = await ollama_client.list_models()
        logger.info("ollama_ready", models=[m.get("name") for m in models])
    else:
        logger.warning(
            "ollama_unavailable",
            url=settings.OLLAMA_BASE_URL,
            hint="Start Ollama with `ollama serve` and pull a model with `ollama pull llama3.2`",
        )

    yield

    logger.info("shutdown")
    await ollama_client.close()
    await close_db()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Local autonomous browser agent powered by Ollama. "
        "Browses the web, reasons, and acts — with human approval for sensitive steps."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS — allow any local dev origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exception handlers
app.add_exception_handler(VellamError, vellam_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

# Routers
app.include_router(health.router)
app.include_router(tasks.router)
app.include_router(agent.router)
app.include_router(ws.router)
app.include_router(debug.router)
app.include_router(vault.router)
app.include_router(profile.router)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    }
