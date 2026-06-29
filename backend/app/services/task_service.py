from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.exceptions import TaskNotFoundError, TaskStateError
from app.core.logging import get_logger
from app.models.task import Task, TaskLog, TaskStatus, TaskType
from app.schemas.task import TaskCreateRequest

logger = get_logger(__name__)


class TaskService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    async def create_task(self, request: TaskCreateRequest) -> Task:
        task = Task(
            goal=request.goal,
            type=request.type,
            status=TaskStatus.PENDING,
            model=request.model or settings.OLLAMA_DEFAULT_MODEL,
            context=request.context,
            max_steps=request.max_steps,
        )
        self.db.add(task)
        await self.db.flush()
        logger.info("task_created", task_id=task.id, type=task.type, goal=task.goal[:80])
        return task

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    async def get_task(self, task_id: str, with_logs: bool = False) -> Task:
        if with_logs:
            stmt = (
                select(Task)
                .where(Task.id == task_id)
                .options(selectinload(Task.logs))
            )
        else:
            stmt = select(Task).where(Task.id == task_id)

        result = await self.db.execute(stmt)
        task = result.scalar_one_or_none()
        if not task:
            raise TaskNotFoundError(task_id)
        return task

    async def list_tasks(
        self,
        page: int = 1,
        page_size: int = 20,
        status: Optional[TaskStatus] = None,
        task_type: Optional[TaskType] = None,
    ) -> tuple[list[Task], int]:
        stmt = select(Task)
        count_stmt = select(func.count()).select_from(Task)

        if status:
            stmt = stmt.where(Task.status == status)
            count_stmt = count_stmt.where(Task.status == status)
        if task_type:
            stmt = stmt.where(Task.type == task_type)
            count_stmt = count_stmt.where(Task.type == task_type)

        stmt = stmt.order_by(Task.created_at.desc())
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)

        tasks_result = await self.db.execute(stmt)
        count_result = await self.db.execute(count_stmt)

        return list(tasks_result.scalars().all()), count_result.scalar_one()

    # ------------------------------------------------------------------
    # Update — every method flushes so changes are visible within the tx
    # ------------------------------------------------------------------

    async def update_status(self, task_id: str, status: TaskStatus) -> Task:
        task = await self.get_task(task_id)
        task.status = status

        now = datetime.now(timezone.utc)
        if status == TaskStatus.RUNNING and not task.started_at:
            task.started_at = now
        if status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            task.completed_at = now

        await self.db.flush()
        logger.info("task_status_updated", task_id=task_id, status=status)
        return task

    async def set_plan(self, task_id: str, plan: str) -> Task:
        task = await self.get_task(task_id)
        task.plan = plan
        await self.db.flush()
        return task

    async def set_result(self, task_id: str, result: str) -> Task:
        task = await self.get_task(task_id)
        task.result = result
        await self.db.flush()
        return task

    async def set_error(self, task_id: str, error: str) -> Task:
        task = await self.get_task(task_id)
        task.error = error
        await self.db.flush()
        return task

    async def increment_steps(self, task_id: str) -> Task:
        task = await self.get_task(task_id)
        task.steps_taken += 1
        await self.db.flush()
        return task

    # ------------------------------------------------------------------
    # Cancel
    # ------------------------------------------------------------------

    async def cancel_task(self, task_id: str, reason: Optional[str] = None) -> Task:
        task = await self.get_task(task_id)
        terminal = {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED}
        if task.status in terminal:
            raise TaskStateError(f"Cannot cancel a task with status '{task.status}'")

        task.status = TaskStatus.CANCELLED
        task.completed_at = datetime.now(timezone.utc)
        if reason:
            task.error = f"Cancelled: {reason}"

        await self.db.flush()
        logger.info("task_cancelled", task_id=task_id, reason=reason)
        return task

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete_task(self, task_id: str) -> None:
        task = await self.get_task(task_id, with_logs=True)
        await self.db.delete(task)
        await self.db.flush()
        logger.info("task_deleted", task_id=task_id)

    # ------------------------------------------------------------------
    # Logs
    # ------------------------------------------------------------------

    async def add_log(
        self,
        task_id: str,
        actor: str,
        step: int,
        action: Optional[str] = None,
        observation: Optional[str] = None,
        reasoning: Optional[str] = None,
        requires_approval: bool = False,
    ) -> TaskLog:
        log = TaskLog(
            task_id=task_id,
            step=step,
            actor=actor,
            action=action,
            observation=observation,
            reasoning=reasoning,
            requires_approval=requires_approval,
        )
        self.db.add(log)
        await self.db.flush()
        return log
