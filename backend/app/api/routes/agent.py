"""
Agent control endpoints.

Part 1: skeleton only — POST /agent/run starts the placeholder loop.
Parts 2+ will expand these with streaming status, step inspection, etc.
"""

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import ask_gate, cred_gate, otp_gate
from app.agent.react_loop import get_latest_screenshot
from app.config import settings
from app.core.logging import get_logger
from app.database import get_db
from app.schemas.task import AgentRunRequest, TaskResponse
from app.services.agent_service import AgentService
from app.services.task_service import TaskService

logger = get_logger(__name__)
router = APIRouter(prefix="/agent", tags=["agent"])


def _services(db: AsyncSession = Depends(get_db)):
    task_svc = TaskService(db)
    return task_svc, AgentService(task_svc)


class AgentStatusResponse(BaseModel):
    task_id: str
    is_running: bool


@router.post("/run", response_model=TaskResponse, summary="Start agent on an existing task")
async def run_agent(
    body: AgentRunRequest,
    services=Depends(_services),
) -> TaskResponse:
    """
    Starts the agent loop for an already-created task.
    Returns immediately; the loop runs in the background.
    Poll GET /tasks/{task_id} or connect via WebSocket (Part 7) for updates.
    """
    task_svc, agent_svc = services
    task = await task_svc.get_task(body.task_id)

    # Build the run's secrets server-side: saved logins come from the encrypted
    # vault (never sent by the browser), merged with any non-credential secrets the
    # client passed (e.g. service API keys). Domain buckets are merged so a vault
    # login and a client secret for the same site coexist.
    from app.services import vault_service
    sensitive = dict(vault_service.build_sensitive_data())
    for k, v in (body.sensitive_data or {}).items():
        if isinstance(v, dict) and isinstance(sensitive.get(k), dict):
            sensitive[k] = {**sensitive[k], **v}
        else:
            sensitive[k] = v

    # Resolve the LLM-provider key (Grok / OpenAI) from the vault based on the task's
    # model, so the browser never has to hold or send it. A client-supplied key still
    # works as an override.
    api_key = body.api_key or vault_service.provider_key_for_model(task.model)

    await agent_svc.start(body.task_id, api_key=api_key, sensitive_data=sensitive or None)
    # Re-fetch to get the updated status after start()
    task = await task_svc.get_task(body.task_id)
    return TaskResponse.model_validate(task)


@router.get("/status/{task_id}", response_model=AgentStatusResponse, summary="Check if agent is running")
async def agent_status(
    task_id: str,
    services=Depends(_services),
) -> AgentStatusResponse:
    task_svc, agent_svc = services
    await task_svc.get_task(task_id)  # 404 if task doesn't exist
    return AgentStatusResponse(task_id=task_id, is_running=agent_svc.is_running(task_id))


@router.post("/stop/{task_id}", response_model=TaskResponse, summary="Stop a running agent")
async def stop_agent(
    task_id: str,
    services=Depends(_services),
) -> TaskResponse:
    task_svc, agent_svc = services
    await agent_svc.stop(task_id)
    task = await task_svc.get_task(task_id)
    return TaskResponse.model_validate(task)


@router.get("/screenshot/{task_id}", summary="Latest browser screenshot for an active task")
async def agent_screenshot(task_id: str):
    """Returns the most recent browser screenshot captured during agent execution."""
    screenshot = get_latest_screenshot(task_id)
    return {"screenshot": screenshot}


class OtpSubmitRequest(BaseModel):
    code: str


@router.post("/otp/{task_id}", summary="Submit an OTP/verification code the agent is waiting for")
async def submit_otp(task_id: str, body: OtpSubmitRequest):
    """
    Hand a user-entered one-time code to the paused agent. The agent's
    request_otp_code tool is blocked waiting for it and resumes once delivered.
    """
    code = (body.code or "").strip()
    if not code:
        return {"ok": False, "error": "No code provided."}
    ok = otp_gate.submit(task_id, code)
    return {"ok": ok, "error": None if ok else "This task is not waiting for an OTP."}


@router.get("/otp/{task_id}", summary="Whether the agent is awaiting an OTP for this task")
async def otp_state(task_id: str):
    """Lets the UI recover the OTP prompt after a reload / missed WebSocket event."""
    return {"waiting": otp_gate.is_waiting(task_id), "reason": otp_gate.get_reason(task_id)}


class CredentialsSubmitRequest(BaseModel):
    username: str
    password: str = ""


@router.post("/credentials/{task_id}", summary="Provide login credentials the agent is waiting for")
async def submit_credentials(task_id: str, body: CredentialsSubmitRequest):
    """
    Hand user-entered sign-in credentials to a paused agent. The agent's
    request_credentials tool is blocked waiting for them and resumes once delivered.
    """
    username = (body.username or "").strip()
    if not username:
        return {"ok": False, "error": "A username is required."}
    ok = cred_gate.submit(task_id, username, body.password or "")
    return {"ok": ok, "error": None if ok else "This task is not waiting for credentials."}


@router.get("/credentials/{task_id}", summary="Whether the agent is awaiting credentials for this task")
async def credentials_state(task_id: str):
    """Lets the UI recover the credentials prompt after a reload / missed WebSocket event."""
    req = cred_gate.get_request(task_id)
    if req is None:
        return {"waiting": False, "site": None, "reason": None}
    return {"waiting": True, "site": req.site, "reason": req.reason}


class AnswerSubmitRequest(BaseModel):
    answer: str


@router.post("/ask/{task_id}", summary="Answer a question the agent is waiting on")
async def submit_answer(task_id: str, body: AnswerSubmitRequest):
    """
    Hand a user's answer to a paused agent. The agent's ask_user tool is blocked
    waiting for it and resumes once delivered.
    """
    answer = (body.answer or "").strip()
    if not answer:
        return {"ok": False, "error": "An answer is required."}
    ok = ask_gate.submit(task_id, answer)
    return {"ok": ok, "error": None if ok else "This task is not waiting for an answer."}


@router.get("/ask/{task_id}", summary="Whether the agent is awaiting an answer for this task")
async def ask_state(task_id: str):
    """Lets the UI recover the question prompt after a reload / missed WebSocket event."""
    req = ask_gate.get_request(task_id)
    if req is None:
        return {"waiting": False, "question": None, "options": []}
    return {"waiting": True, "question": req.question, "options": req.options}


class XaiModelsRequest(BaseModel):
    # Optional override; normally the key is read from the encrypted vault so it
    # never has to be held by or sent from the browser.
    api_key: str = ""


@router.post("/xai/models", summary="List available Grok (xAI) models")
async def xai_models(body: XaiModelsRequest = XaiModelsRequest()):
    """
    Server-side proxy to the xAI /models endpoint. Done here (not in the browser)
    because the xAI API does not permit cross-origin requests and we never want
    the key in a URL. The key is resolved from the vault. Returns {"models": [...]}.
    """
    from app.services import vault_service
    api_key = (body.api_key or "").strip() or vault_service.get_api_key(vault_service.GROK_KEY_NAME)
    if not api_key.strip():
        return {"models": [], "error": "No API key provided."}
    body = XaiModelsRequest(api_key=api_key)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{settings.XAI_BASE_URL}/models",
                headers={"Authorization": f"Bearer {body.api_key.strip()}"},
            )
        if resp.status_code == 401:
            return {"models": [], "error": "Invalid API key."}
        resp.raise_for_status()
        data = resp.json()
        models = sorted(m.get("id") for m in data.get("data", []) if m.get("id"))
        return {"models": models}
    except httpx.HTTPStatusError as exc:
        return {"models": [], "error": f"xAI returned {exc.response.status_code}"}
    except Exception as exc:
        logger.warning("xai_models_failed", error=str(exc))
        return {"models": [], "error": "Could not reach the xAI API."}


class OpenAIModelsRequest(BaseModel):
    # Optional override; normally the key is read from the encrypted vault.
    api_key: str = ""


# Chat-capable model id prefixes, and substrings that mark non-chat models
# (embeddings, audio, image, moderation, ...) which we hide from the picker.
_OPENAI_CHAT_PREFIXES = ("gpt", "chatgpt", "o1", "o3", "o4")
_OPENAI_EXCLUDE = (
    "embedding", "audio", "realtime", "transcribe", "tts", "whisper",
    "image", "dall", "moderation", "instruct", "search", "computer-use",
)


@router.post("/openai/models", summary="List available chat models for OpenAI")
async def openai_models(body: OpenAIModelsRequest = OpenAIModelsRequest()):
    """
    Server-side proxy to the OpenAI /models endpoint. Returns only chat-capable
    models, sorted. The key is resolved from the vault. Shape: {"models": [...]}.
    """
    from app.services import vault_service
    api_key = (body.api_key or "").strip() or vault_service.get_api_key(vault_service.OPENAI_KEY_NAME)
    if not api_key.strip():
        return {"models": [], "error": "No API key provided."}
    body = OpenAIModelsRequest(api_key=api_key)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{settings.OPENAI_BASE_URL}/models",
                headers={"Authorization": f"Bearer {body.api_key.strip()}"},
            )
        if resp.status_code == 401:
            return {"models": [], "error": "Invalid API key."}
        resp.raise_for_status()
        data = resp.json()
        ids = (m.get("id", "") for m in data.get("data", []) if m.get("id"))
        models = sorted(
            i for i in ids
            if i.lower().startswith(_OPENAI_CHAT_PREFIXES)
            and not any(x in i.lower() for x in _OPENAI_EXCLUDE)
        )
        return {"models": models}
    except httpx.HTTPStatusError as exc:
        return {"models": [], "error": f"OpenAI returned {exc.response.status_code}"}
    except Exception as exc:
        logger.warning("openai_models_failed", error=str(exc))
        return {"models": [], "error": "Could not reach the OpenAI API."}
