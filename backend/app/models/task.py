import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class TaskStatus(str, PyEnum):
    PENDING = "pending"
    PLANNING = "planning"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    WAITING_OTP = "waiting_otp"
    WAITING_CREDENTIALS = "waiting_credentials"
    WAITING_INPUT = "waiting_input"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskType(str, PyEnum):
    SHOPPING = "shopping"
    JOB_SEARCH = "job_search"
    GENERAL = "general"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    type: Mapped[str] = mapped_column(Enum(TaskType), nullable=False, default=TaskType.GENERAL)
    status: Mapped[str] = mapped_column(Enum(TaskStatus), nullable=False, default=TaskStatus.PENDING)

    goal: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(Text, nullable=True)

    model: Mapped[str] = mapped_column(String(128), nullable=False)

    # Populated as the agent progresses
    plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Upload path for resume/files (Part 5)
    upload_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Timing
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Agent step counter
    steps_taken: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_steps: Mapped[int] = mapped_column(Integer, default=40, nullable=False)

    logs: Mapped[list["TaskLog"]] = relationship(
        "TaskLog", back_populates="task", cascade="all, delete-orphan", lazy="select"
    )

    def __repr__(self) -> str:
        return f"<Task id={self.id} type={self.type} status={self.status}>"


class TaskLog(Base):
    """One entry per agent step: action taken, observation received, reasoning used."""

    __tablename__ = "task_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)

    step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # What layer produced this log
    actor: Mapped[str] = mapped_column(String(64), nullable=False)  # "planner"|"executor"|"browser"|"user"

    action: Mapped[str | None] = mapped_column(String(256), nullable=True)
    observation: Mapped[str | None] = mapped_column(Text, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Was this a sensitive action that required approval?
    requires_approval: Mapped[bool] = mapped_column(default=False, nullable=False)
    approved: Mapped[bool | None] = mapped_column(nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    task: Mapped["Task"] = relationship("Task", back_populates="logs")

    def __repr__(self) -> str:
        return f"<TaskLog task={self.task_id} step={self.step} actor={self.actor}>"
