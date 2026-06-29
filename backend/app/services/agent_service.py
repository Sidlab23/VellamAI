"""
Agent orchestration service.
Kicks off the ReAct loop in a background asyncio task and manages its lifecycle.

Key fix: the background task opens its OWN DB session instead of reusing the
request-scoped session (which is already closed by the time the task runs).
"""

import asyncio

from app.api.ws_manager import manager as ws_manager
from app.core.logging import get_logger
from app.database import AsyncSessionLocal
from app.models.task import TaskStatus
from app.services.task_service import TaskService

logger = get_logger(__name__)

# task_id → running asyncio.Task
_running: dict[str, asyncio.Task] = {}


class AgentService:
    def __init__(self, task_service: TaskService):
        self.task_service = task_service  # used only for is_running / stop status update

    async def start(
        self, task_id: str, api_key: str | None = None, sensitive_data: dict | None = None
    ) -> None:
        """Start the ReAct loop for a task. Non-blocking — returns immediately."""
        if task_id in _running and not _running[task_id].done():
            logger.warning("agent_already_running", task_id=task_id)
            return

        bg_task = asyncio.create_task(
            _run_agent(task_id, api_key, sensitive_data), name=f"agent-{task_id}"
        )
        _running[task_id] = bg_task
        logger.info("agent_started", task_id=task_id)

    async def stop(self, task_id: str) -> None:
        """Cancel a running agent loop."""
        # Unblock the agent if it's parked waiting for an OTP, for credentials, or
        # for an answer to a question, so cancellation lands.
        from app.agent import ask_gate, cred_gate, otp_gate
        otp_gate.cancel(task_id)
        cred_gate.cancel(task_id)
        ask_gate.cancel(task_id)

        # Halt the browser-use agent immediately: this sets its stop flag AND
        # aborts the in-flight LLM request on the agent's own worker thread, so we
        # stop spending API tokens the moment Stop is pressed. Cancelling the
        # asyncio task below alone does NOT stop that thread's LLM calls.
        from app.agent.react_loop import stop_agent
        stop_agent(task_id)

        if task_id in _running:
            _running[task_id].cancel()
            try:
                await _running[task_id]
            except (asyncio.CancelledError, Exception):
                pass
            _running.pop(task_id, None)

        # Open a fresh session just to write the cancelled status
        async with AsyncSessionLocal() as session:
            svc = TaskService(session)
            try:
                await svc.update_status(task_id, TaskStatus.CANCELLED)
                await session.commit()
            except Exception:
                await session.rollback()
        logger.info("agent_stopped", task_id=task_id)

    def is_running(self, task_id: str) -> bool:
        return task_id in _running and not _running[task_id].done()


async def _run_agent(
    task_id: str, api_key: str | None = None, sensitive_data: dict | None = None
) -> None:
    """
    Top-level background coroutine.
    Opens its own DB session so it is fully independent of the HTTP request lifecycle.
    """
    async with AsyncSessionLocal() as session:
        svc = TaskService(session)
        try:
            from app.agent.react_loop import ReactLoop  # lazy import breaks circular dep
            task = await svc.get_task(task_id)
            loop = ReactLoop(
                task_service=svc,
                ws_broadcast=ws_manager.broadcast,
            )
            await loop.run(task, api_key=api_key, sensitive_data=sensitive_data)
            await session.commit()
        except asyncio.CancelledError:
            logger.info("agent_loop_cancelled", task_id=task_id)
            try:
                await svc.update_status(task_id, TaskStatus.CANCELLED)
                await session.commit()
            except Exception:
                await session.rollback()
        except Exception as exc:
            logger.exception("agent_loop_unhandled_error", task_id=task_id, error=str(exc))
            try:
                await svc.set_error(task_id, str(exc))
                await svc.update_status(task_id, TaskStatus.FAILED)
                await session.commit()
            except Exception:
                await session.rollback()
        finally:
            _running.pop(task_id, None)
