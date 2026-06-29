"""
Cross-thread gate for human-supplied login credentials.

Mirror of otp_gate: when the browser-use agent (running in its own worker thread)
needs to sign in to a site but no saved credentials were provided for it, the
`request_credentials` tool opens a request here and blocks on a threading.Event
until the user supplies a username/password via POST /agent/credentials/{id},
which runs on the FastAPI main loop. A threading primitive is used because the
two sides live on different event loops / threads.
"""

import threading
from dataclasses import dataclass, field


@dataclass
class _CredRequest:
    site: str
    reason: str
    event: threading.Event = field(default_factory=threading.Event)
    username: str | None = None
    password: str | None = None
    cancelled: bool = False


_lock = threading.Lock()
_pending: dict[str, _CredRequest] = {}


def open_request(task_id: str, site: str, reason: str) -> _CredRequest:
    """Register a pending credential request for a task (called from the agent thread)."""
    with _lock:
        req = _CredRequest(
            site=site or "this site",
            reason=reason or "The site requires you to sign in to continue.",
        )
        _pending[task_id] = req
        return req


def submit(task_id: str, username: str, password: str) -> bool:
    """Deliver user-entered credentials. Returns False if nothing is waiting."""
    with _lock:
        req = _pending.get(task_id)
    if req is None or req.event.is_set():
        return False
    req.username = username
    req.password = password
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


def get_request(task_id: str) -> _CredRequest | None:
    with _lock:
        req = _pending.get(task_id)
        return req if req is not None and not req.event.is_set() else None


def clear(task_id: str) -> None:
    with _lock:
        _pending.pop(task_id, None)
