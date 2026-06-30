# Vellam

**A local AI browser agent for Windows.** Vellam runs an autonomous agent that
browses the web, reasons, and completes tasks for you — comparing prices, searching
listings, filling forms — pausing for your approval on sensitive steps (sign-ins,
OTPs, payments). It runs entirely on your own machine.

> Powered by local models via [Ollama](https://ollama.com), or your own
> OpenAI / xAI API key.

---

## ⬇️ Download (Windows)

**[Download the latest installer →](https://github.com/Sidlab23/VellamAI/releases/latest)**
Grab `Vellam-Setup-x.y.z.exe`, run it, then launch **Vellam** from the Start menu or
desktop shortcut.

> The installer isn't code-signed, so Windows SmartScreen may say
> *"Windows protected your PC"* the first time — click **More info → Run anyway**.

### Requirements
- **Windows 10 / 11, 64-bit**
- An AI model — **either**:
  - **[Ollama](https://ollama.com/download)** installed with a model pulled
    (`ollama pull llama3.2`) — free, runs locally, wants a decent amount of RAM; **or**
  - an **OpenAI or xAI API key**, entered in the app's *API keys* panel — runs in the
    cloud, works on any PC.

Everything else (the app, the Python backend, and a Chromium browser) is bundled in
the installer — no Python, Node.js, or extra setup required.

---

## First run
1. Launch **Vellam**. On first start a splash screen shows for ~20–30s while services
   come up.
2. If you use Ollama, the app starts it automatically (or points you to install it).
3. Describe a task, e.g. *"Find a laptop under ₹60,000 on Flipkart with 16GB RAM and
   good battery life."*

Your data — task history, the encrypted credential vault, and logs — stays local under
`%APPDATA%\Vellam`.

---

## Build from source
The desktop app is assembled in the [`desktop/`](desktop/) folder; see
**[desktop/README.md](desktop/README.md)** for the full guide. In short:

```sh
cd desktop
npm install
npm run dist:full          # builds frontend + backend + the installer
```

Output: `desktop/dist/Vellam-Setup-<version>.exe`.

### Run in development (no packaging)
```sh
# 1) backend  (Python 3.12–3.14)
cd backend && pip install -r requirements.txt && python run.py
# 2) frontend
cd frontend && npm install && npm run dev
# 3) desktop shell
cd desktop && npm install && npm run dev
```

---

## How it works
- **Frontend** — a Next.js UI (static export), served inside the app window.
- **Backend** — FastAPI + [browser-use](https://github.com/browser-use/browser-use)
  driving Chromium; talks to Ollama or a cloud LLM.
- **Desktop shell** — Electron ([desktop/main.js](desktop/main.js)) starts Ollama, the
  backend, and the UI together in one window and shuts them down on close.

## Project layout
| Folder | What it is |
|---|---|
| `backend/` | FastAPI agent backend (Python) |
| `frontend/` | Next.js UI |
| `desktop/` | Electron wrapper + installer build config |

## License
Not yet specified — add a `LICENSE` file to set usage terms.
