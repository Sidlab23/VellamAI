"""
WebSocket endpoint — real-time task updates.

Connect: ws://localhost:8000/ws/tasks/{task_id}

The server sends JSON events:
  { "type": "status_update"|"log"|"observation"|"thinking"|"completed"|"failed"|"approval_required",
    "task_id": "...",
    "data": {...},
    "ts": "2024-..." }

The client can send:
  { "type": "ping" }  → server replies { "type": "pong" }
"""

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.ws_manager import manager
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/tasks/{task_id}")
async def task_ws(task_id: str, ws: WebSocket) -> None:
    await manager.connect(task_id, ws)
    try:
        # Confirm connection
        await manager.send_to(ws, {
            "type": "connected",
            "task_id": task_id,
            "data": {"message": f"Subscribed to task {task_id}"},
        })

        # Keep connection alive; handle pings from client
        while True:
            try:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await manager.send_to(ws, {"type": "pong", "task_id": task_id})
            except WebSocketDisconnect:
                break
            except Exception:
                break

    finally:
        manager.disconnect(task_id, ws)
