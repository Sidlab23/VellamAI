from typing import Optional

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.task import TaskStatus, TaskType
from app.schemas.task import (
    ApprovalRequest,
    ClarifyQuestionsResponse,
    ClarifySubmitRequest,
    TaskCancelRequest,
    TaskCreateRequest,
    TaskDetailResponse,
    TaskListResponse,
    TaskResponse,
)
from app.services.clarify_service import generate_questions
from app.services.task_service import TaskService

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _task_service(db: AsyncSession = Depends(get_db)) -> TaskService:
    return TaskService(db)


@router.post("", response_model=TaskResponse, status_code=201, summary="Create a new task")
async def create_task(
    body: TaskCreateRequest,
    svc: TaskService = Depends(_task_service),
) -> TaskResponse:
    task = await svc.create_task(body)
    return TaskResponse.model_validate(task)


@router.get("", response_model=TaskListResponse, summary="List tasks")
async def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[TaskStatus] = Query(None),
    type: Optional[TaskType] = Query(None),
    svc: TaskService = Depends(_task_service),
) -> TaskListResponse:
    tasks, total = await svc.list_tasks(page=page, page_size=page_size, status=status, task_type=type)
    return TaskListResponse(
        tasks=[TaskResponse.model_validate(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{task_id}", response_model=TaskDetailResponse, summary="Get task with logs")
async def get_task(
    task_id: str,
    svc: TaskService = Depends(_task_service),
) -> TaskDetailResponse:
    task = await svc.get_task(task_id, with_logs=True)
    return TaskDetailResponse.model_validate(task)


@router.post("/{task_id}/cancel", response_model=TaskResponse, summary="Cancel a running task")
async def cancel_task(
    task_id: str,
    body: TaskCancelRequest,
    svc: TaskService = Depends(_task_service),
) -> TaskResponse:
    task = await svc.cancel_task(task_id, reason=body.reason)
    return TaskResponse.model_validate(task)


@router.delete("/{task_id}", status_code=204, summary="Delete a task")
async def delete_task(
    task_id: str,
    svc: TaskService = Depends(_task_service),
) -> None:
    await svc.delete_task(task_id)


class QuestionsRequest(BaseModel):
    # Hosted models (Grok / OpenAI) need their key to generate questions.
    api_key: Optional[str] = None


@router.post(
    "/{task_id}/questions",
    response_model=ClarifyQuestionsResponse,
    summary="Generate clarifying questions for a task",
)
async def task_questions(
    task_id: str,
    body: QuestionsRequest = Body(default=QuestionsRequest()),
    svc: TaskService = Depends(_task_service),
) -> ClarifyQuestionsResponse:
    """
    Asks the task's model to produce 3-4 clarifying questions about the goal.
    Always returns a form (a generic fallback set is used if the model can't
    generate task-specific questions).
    """
    task = await svc.get_task(task_id)
    # Provider key (Grok/OpenAI) comes from the encrypted vault so the browser never
    # holds it; a client-supplied key still works as an override.
    from app.services import vault_service
    api_key = body.api_key or vault_service.provider_key_for_model(task.model)
    questions = await generate_questions(task.goal, task.context, task.model, api_key)
    return ClarifyQuestionsResponse(task_id=task_id, questions=questions)


@router.post(
    "/{task_id}/clarify",
    response_model=TaskResponse,
    summary="Submit clarification answers for a task",
)
async def submit_clarifications(
    task_id: str,
    body: ClarifySubmitRequest,
    svc: TaskService = Depends(_task_service),
) -> TaskResponse:
    """Appends the user's Q&A answers to the task context before the agent runs."""
    task = await svc.get_task(task_id)

    answered = [a for a in body.answers if a.answer.strip()]
    if answered:
        qa_block = "\n".join(f"- {a.question.strip()}: {a.answer.strip()}" for a in answered)
        addition = f"User clarifications:\n{qa_block}"
        task.context = f"{task.context}\n\n{addition}" if task.context else addition
        await svc.db.flush()

    return TaskResponse.model_validate(task)


@router.post(
    "/{task_id}/approve",
    response_model=TaskResponse,
    summary="Approve or reject a pending sensitive action",
)
async def approve_action(
    task_id: str,
    body: ApprovalRequest,
    svc: TaskService = Depends(_task_service),
) -> TaskResponse:
    """
    When the agent is waiting for approval on a sensitive action
    (checkout, payment, job application), call this endpoint.
    Full approval logic wired in Part 6.
    """
    task = await svc.get_task(task_id)
    new_status = TaskStatus.APPROVED if body.approved else TaskStatus.REJECTED
    task = await svc.update_status(task_id, new_status)
    return TaskResponse.model_validate(task)
