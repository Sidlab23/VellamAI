"""Frozen (PyInstaller) entry point for the Vellam backend.

This is the entry the desktop build bundles into `vellam-backend.exe`. It differs
from the dev entry [run.py](run.py) in two ways that matter under PyInstaller:

  * It imports the FastAPI **app object** and hands it to uvicorn directly, instead
    of passing the import string "app.main:app". A frozen build has no source tree
    for uvicorn to re-import by string, and reload/workers (which fork by string)
    don't work once frozen — so we run the in-process app object with reload off.
  * It calls multiprocessing.freeze_support() first. Some dependencies spawn helper
    processes; without this, a frozen child can re-run the whole program.

Writable files (vellam.db, vault.enc, logs/, uploads/) are CWD-relative, so the
Electron main process launches this exe with its working directory set to the
per-user data dir (%APPDATA%/Vellam). Host/port/paths can all be overridden via the
VELLAM_* environment variables that app.config already reads.
"""

import asyncio
import multiprocessing
import sys

# Windows SelectorEventLoop cannot create subprocesses (Playwright needs them).
# Force the Proactor loop, exactly as run.py does for the dev server.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


def main() -> None:
    import uvicorn
    from app.config import settings
    from app.main import app

    uvicorn.run(
        app,
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        log_level=settings.LOG_LEVEL.lower(),
    )


if __name__ == "__main__":
    # Required so a frozen exe that spawns child processes doesn't re-launch the app.
    multiprocessing.freeze_support()
    main()
