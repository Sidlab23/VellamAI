from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.task import TaskStatus, TaskType


# --- Request schemas ---

class TaskCreateRequest(BaseModel):
    goal: str = Field(..., min_length=5, max_length=2000, description="What the agent should accomplish")
    type: TaskType = Field(default=TaskType.GENERAL, description="Category of task")
    context: Optional[str] = Field(None, max_length=4000, description="Extra context (e.g. preferences, constraints)")
    model: Optional[str] = Field(None, description="Ollama model to use; defaults to server setting")
    max_steps: int = Field(default=40, ge=1, le=50, description="Maximum agent steps before stopping")

    @field_validator("goal")
    @classmethod
    def goal_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Goal cannot be blank")
        return v.strip()


class TaskCancelRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)


class ClarifyAnswer(BaseModel):
    question: str = Field(..., max_length=500)
    answer: str = Field("", max_length=2000)


class ClarifySubmitRequest(BaseModel):
    answers: list[ClarifyAnswer] = Field(default_factory=list)


class ClarifyQuestion(BaseModel):
    id: int
    question: str
    type: str = "text"  # "text" | "choice"
    options: list[str] = []
    placeholder: Optional[str] = None


class ClarifyQuestionsResponse(BaseModel):
    task_id: str
    questions: list[ClarifyQuestion]


class ApprovalRequest(BaseModel):
    approved: bool
    note: Optional[str] = Field(None, max_length=500)


# --- Response schemas ---

class TaskLogResponse(BaseModel):
    id: int
    step: int
    actor: str
    action: Optional[str]
    observation: Optional[str]
    reasoning: Optional[str]
    requires_approval: bool
    approved: Optional[bool]
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskResponse(BaseModel):
    id: str
    type: TaskType
    status: TaskStatus
    goal: str
    context: Optional[str]
    model: str
    plan: Optional[str]
    result: Optional[str]
    error: Optional[str]
    upload_path: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    steps_taken: int
    max_steps: int

    model_config = {"from_attributes": True}


class TaskDetailResponse(TaskResponse):
    logs: list[TaskLogResponse] = []

    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int
    page: int
    page_size: int


# --- Agent run request (placeholder for Parts 2+) ---

class AgentRunRequest(BaseModel):
    task_id: str = Field(..., description="ID of the task to run")
    api_key: Optional[str] = Field(
        None, description="LLM provider API key (e.g. xAI/Grok), used only for this run"
    )
    sensitive_data: Optional[dict] = Field(
        None,
        description=(
            "Run-only secrets (credentials / service API keys) passed to "
            "browser-use as sensitive_data. The model sees only placeholder names; "
            "values are never persisted or sent in the prompt."
        ),
    )
