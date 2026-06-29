"""Quick debug endpoints — check task state and Ollama in one call."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.ollama_client import ollama_client
from app.services.task_service import TaskService
from app.api.ws_manager import manager as ws_manager

router = APIRouter(prefix="/debug", tags=["debug"])


@router.get("/task/{task_id}")
async def debug_task(task_id: str, db: AsyncSession = Depends(get_db)):
    svc = TaskService(db)
    try:
        task = await svc.get_task(task_id, with_logs=True)
        return {
            "id": task.id,
            "status": task.status,
            "steps_taken": task.steps_taken,
            "error": task.error,
            "result": task.result[:200] if task.result else None,
            "logs_count": len(task.logs),
            "ws_subscribers": ws_manager.subscriber_count(task_id),
            "last_log": {
                "step": task.logs[-1].step,
                "actor": task.logs[-1].actor,
                "action": task.logs[-1].action,
                "reasoning": (task.logs[-1].reasoning or "")[:200],
            } if task.logs else None,
        }
    except Exception as exc:
        return {"error": str(exc)}


@router.get("/ollama")
async def debug_ollama():
    available = await ollama_client.is_available()
    models = []
    if available:
        try:
            raw = await ollama_client.list_models()
            models = [m.get("name") for m in raw]
        except Exception as e:
            return {"available": True, "error": str(e)}
    return {"available": available, "models": models}
