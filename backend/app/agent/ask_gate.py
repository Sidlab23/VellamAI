"""
Cross-thread gate for free-form questions the agent asks the user mid-run.

Same pattern as otp_gate / cred_gate: when the browser-use agent (in its worker
thread) needs a decision from the user — e.g. "no products under ₹500, raise the
budget?" — the `ask_user` tool opens a request here and blocks on a threading.Event
until the user answers via POST /agent/ask/{id}, which runs on the FastAPI main loop.
"""

import threading
from dataclasses import dataclass, field


@dataclass
class _AskRequest:
    question: str
    options: list[str] = field(default_factory=list)
    event: threading.Event = field(default_factory=threading.Event)
    answer: str | None = None
    cancelled: bool = False


_lock = threading.Lock()
_pending: dict[str, _AskRequest] = {}


def open_request(task_id: str, question: str, options: list[str] | None = None) -> _AskRequest:
    """Register a pending question for a task (called from the agent thread)."""
    with _lock:
        req = _AskRequest(
            question=question or "The agent needs your input to continue.",
            options=[o for o in (options or []) if str(o).strip()],
        )
        _pending[task_id] = req
        return req


def submit(task_id: str, answer: str) -> bool:
    """Deliver a user answer. Returns False if nothing is waiting."""
    with _lock:
        req = _pending.get(task_id)
    if req is None or req.event.is_set():
        return False
    req.answer = answer
    req.event.set()
    return True


def cancel(task_id: str) -> None:
    """Unblock a waiting request without an answer (task cancelled / shutting down)."""
    with _lock:
        req = _pending.get(task_id)
    if req is not None and not req.event.is_set():
        req.cancelled = True
        req.event.set()


def is_waiting(task_id: str) -> bool:
    with _lock:
        req = _pending.get(task_id)
        return req is not None and not req.event.is_set()


def get_request(task_id: str) -> _AskRequest | None:
    with _lock:
        req = _pending.get(task_id)
        return req if req is not None and not req.event.is_set() else None


def clear(task_id: str) -> None:
    with _lock:
        _pending.pop(task_id, None)
