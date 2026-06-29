# Vellam Desktop (Windows)

Packages Vellam — the Next.js UI + FastAPI/`browser_use` backend + Ollama — into a
single Windows desktop app installed from one `Vellam-Setup-<version>.exe`.

The Electron main process ([main.js](main.js)) starts everything on launch:

1. **Ollama** — detects a running server on `:11434`; if absent, launches
   `ollama serve` (from PATH or `%LOCALAPPDATA%\Programs\Ollama`), or points the user
   to https://ollama.com/download.
2. **Backend** — spawns the bundled `vellam-backend.exe` on `127.0.0.1:8000`, with its
   working directory set to `%APPDATA%/Vellam` so the database, vault, logs and uploads
   live in writable per-user storage. The shipped Chromium is passed via
   `VELLAM_BROWSER_EXECUTABLE_PATH`.
3. **Frontend** — serves the static export (`frontend/out`) from a localhost port and
   loads it once `/health` responds.

## Prerequisites (build machine only)

- **Node** 18+ and **npm**
- **Python** 3.12–3.14 with the backend deps installed and `pyinstaller`
  (`pip install -r ../backend/requirements.txt pyinstaller`)
- Internet access on first build (Electron downloads its binaries; Playwright
  downloads Chromium ~150 MB)

End users need **none** of this — only Ollama (auto-handled) and a model pulled
(`ollama pull llama3.2`).

## Build the installer

```sh
cd desktop
npm install            # electron + electron-builder (one-time)
npm run dist:full      # builds frontend export + backend bundle + Chromium, then NSIS
```

`dist:full` runs three stages; you can run them individually:

```sh
npm run build:frontend   # → ../frontend/out
npm run build:backend    # → ../backend/dist/vellam-backend  +  ../backend/pw-browsers
npm run dist             # → desktop/dist/Vellam-Setup-<version>.exe   (uses prebuilt outputs)
```

Output: **`desktop/dist/Vellam-Setup-<version>.exe`** (~700 MB — it bundles Python +
Chromium; this is expected).

## Develop without packaging

In three terminals:

```sh
python backend/run.py                 # backend on :8000
cd frontend && npm run dev            # next dev on :3000
cd desktop  && npm install && npm run dev   # Electron loads http://localhost:3000
```

In dev mode (`ELECTRON_DEV=1`) the app does **not** spawn the bundled backend or set a
browser path — you run the backend yourself and `browser_use` finds a local browser.

## How it works vs. running the pieces by hand

Previously Vellam was started as three separate processes (Ollama, the FastAPI backend,
and a Next.js server) with a browser tab on top. The desktop app replaces all of that with
one window: the same processes are started and supervised by `main.js`, and shut down
(backend + its child Chromium) when the window closes.

## Notes

- The backend is frozen from [../backend/server_main.py](../backend/server_main.py) using
  [../backend/vellam-backend.spec](../backend/vellam-backend.spec).
- To re-pin Chromium, delete `../backend/pw-browsers` and re-run `npm run build:backend`.
- Replace [build/icon.ico](build/icon.ico) with a real branded icon to change the app/installer icon.
