# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Vellam backend (desktop build).

Produces a one-folder bundle at dist/vellam-backend/ whose entry is
vellam-backend.exe. The Electron app ships this folder as an extraResource and
launches the exe with cwd = %APPDATA%/Vellam and PLAYWRIGHT_BROWSERS_PATH set to
the bundled Chromium.

Build:  python -m PyInstaller --noconfirm vellam-backend.spec

The tricky dependencies here are browser_use + its lazily-imported LLM providers
and watchdogs (PyInstaller's static analysis can't see __getattr__ / lazy imports),
and uvicorn's auto-selected loop/protocol implementations. Both are pulled in
explicitly below.
"""

import sys

from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files

sys.setrecursionlimit(5000)

datas = []
binaries = []
hiddenimports = []


# Packages with data files and/or lazy/dynamic submodules. collect_all grabs their
# datas, binaries, and every submodule so dynamic imports inside them resolve.
for pkg in (
    'browser_use',     # agent, browser session, watchdogs, LLM providers (lazy)
    'playwright',      # used by app/browser/controller.py connect_over_cdp + CDP client
    'pydantic',
    'pydantic_settings',
    'fastapi',
    'starlette',
    'uvicorn',
    'structlog',
    'openai',          # ChatOpenAI / xAI (OpenAI-compatible)
    'ollama',          # ChatOllama (local models)
    'cdp_use',         # browser_use CDP transport
    'bubus',           # browser_use event bus
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as exc:  # pragma: no cover - build-time diagnostics only
        print(f"[spec] collect_all({pkg!r}) skipped: {exc}")

# The app's own routes/services/agent modules — some are wired up dynamically.
hiddenimports += collect_submodules('app')

# Data-only collections (no code to import, just bundled files).
for pkg in ('certifi', 'tiktoken_ext'):
    try:
        datas += collect_data_files(pkg)
    except Exception:
        pass

# Imports PyInstaller's static graph misses: uvicorn picks loop/protocol impls by
# name at runtime; the browser_use LLM providers the app uses are lazy; SQLAlchemy's
# aiosqlite dialect and python-multipart's form parser are imported by string.
hiddenimports += [
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    'websockets',
    'websockets.legacy',
    'aiosqlite',
    'sqlalchemy.dialects.sqlite',
    'sqlalchemy.dialects.sqlite.aiosqlite',
    'multipart',
    'aiofiles',
    'browser_use.llm.ollama.chat',
    'browser_use.llm.ollama.serializer',
    'browser_use.llm.openai.chat',
    'browser_use.llm.models',
]

# Trim obvious dead weight that some transitive deps drag in.
excludes = [
    'tkinter',
    'matplotlib',
    'pytest',
    'IPython',
    'notebook',
    'PyQt5',
    'PySide6',
]


a = Analysis(
    ['server_main.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='vellam-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,            # keep stdout/stderr visible; Electron pipes it to a log
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='vellam-backend',
)
