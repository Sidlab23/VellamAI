"""
In-memory WebSocket connection manager.
One channel per task_id — multiple clients can subscribe to the same task.
"""

from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from app.core.logging import get_logger

logger = get_logger(__name__)


class ConnectionManager:
    def __init__(self):
        # task_id → list of connected WebSockets
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, task_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[task_id].append(ws)
        logger.info("ws_client_connected", task_id=task_id, total=len(self._connections[task_id]))

    def disconnect(self, task_id: str, ws: WebSocket) -> None:
        conns = self._connections.get(task_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(task_id, None)
        logger.info("ws_client_disconnected", task_id=task_id)

    async def broadcast(self, task_id: str, message: dict[str, Any]) -> None:
        """Send a JSON message to all clients watching this task."""
        dead: list[WebSocket] = []
        for ws in list(self._connections.get(task_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(task_id, ws)

    async def send_to(self, ws: WebSocket, message: dict[str, Any]) -> None:
        try:
            await ws.send_json(message)
        except Exception as exc:
            logger.warning("ws_send_failed", error=str(exc))

    def subscriber_count(self, task_id: str) -> int:
        return len(self._connections.get(task_id, []))


# Module-level singleton shared across the app
manager = ConnectionManager()
