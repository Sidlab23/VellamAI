"""
Cross-thread gate for human-supplied OTP / verification codes.

The browser-use agent runs in a dedicated worker thread. When it hits a page that
needs a one-time code, the `request_otp_code` tool opens a request here and blocks
(on a threading.Event) until the user submits the code via POST /agent/otp/{id},
which runs on the FastAPI main loop. A threading primitive is used precisely
because the two sides live on different event loops / threads.
"""

import threading
from dataclasses import dataclass, field


@dataclass
class _OtpRequest:
    reason: str
    event: threading.Event = field(default_factory=threading.Event)
    value: str | None = None
    cancelled: bool = False


_lock = threading.Lock()
_pending: dict[str, _OtpRequest] = {}


def open_request(task_id: str, reason: str) -> _OtpRequest:
    """Register a pending OTP request for a task (called from the agent thread)."""
    with _lock:
        req = _OtpRequest(reason=reason or "A site requested a verification code.")
        _pending[task_id] = req
        return req


def submit(task_id: str, code: str) -> bool:
    """Deliver a user-entered code. Returns False if nothing is waiting."""
    with _lock:
        req = _pending.get(task_id)
    if req is None or req.event.is_set():
        return False
    req.value = code
    req.event.set()
    return True


def cancel(task_id: str) -> None:
    """Unblock a waiting request without a value (task cancelled / shutting down)."""
    with _lock:
        req = _pending.get(task_id)
    if req is not None and not req.event.is_set():
        req.cancelled = True
        req.event.set()


def is_waiting(task_id: str) -> bool:
    with _lock:
        req = _pending.get(task_id)
        return req is not None and not req.event.is_set()


def get_reason(task_id: str) -> str | None:
    with _lock:
        req = _pending.get(task_id)
        return req.reason if req is not None and not req.event.is_set() else None


def clear(task_id: str) -> None:
    with _lock:
        _pending.pop(task_id, None)
