"""Development server entry point. Run with: python run.py"""

import asyncio
import socket
import sys

# Windows SelectorEventLoop does not support subprocess creation (needed by Playwright).
# Force ProactorEventLoop so asyncio.create_subprocess_exec() works correctly.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn
from app.config import settings


def _port_available(host: str, port: int) -> bool:
    """True if we can bind the port right now."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


if __name__ == "__main__":
    if not _port_available(settings.HOST, settings.PORT):
        print(
            f"\nERROR: port {settings.PORT} on {settings.HOST} is already in use.\n"
            f"Another Vellam backend (or other program) is listening there.\n\n"
            f"Find it:   netstat -ano | findstr :{settings.PORT}\n"
            f"Stop it:   taskkill /PID <pid> /F\n"
            f"Or run start-production.bat, which frees the port automatically.\n",
            file=sys.stderr,
        )
        sys.exit(1)

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )
