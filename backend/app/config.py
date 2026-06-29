from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="VELLAM_",
        case_sensitive=False,
    )

    # Application
    APP_NAME: str = "Vellam"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True
    # Single-user local app: bind loopback only. 0.0.0.0 invites firewall
    # prompts and WinError 10013 conflicts with other listeners on Windows.
    HOST: str = "127.0.0.1"
    PORT: int = 8000

    # Ollama
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_DEFAULT_MODEL: str = "llama3.2"
    # HTTP-client timeout for a single Ollama request. Local models on modest
    # hardware (especially when they spill past VRAM onto the CPU) can take a
    # while to produce a full structured-JSON response, so this is generous.
    # Keep it >= LLM_TIMEOUT so the client never cuts a call off before
    # browser-use's own timeout does (which gives a clearer message).
    OLLAMA_TIMEOUT: int = 360

    # browser-use agent timeouts (per LLM call / per step). These default to
    # 75s / 180s inside browser-use, which is too tight for small local models.
    LLM_TIMEOUT: int = 300        # seconds for one LLM call
    # A "step" includes any step where the agent pauses for the user (OTP, sign-in,
    # a confirm-before-ordering question), so this also caps how long that pause can
    # last. Keep it >= HUMAN_INPUT_TIMEOUT so the agent isn't killed mid-wait while
    # the user is reading the prompt / fetching a code. The LLM call is bounded
    # separately by LLM_TIMEOUT, and the user can always Stop, so a long ceiling here
    # mainly just gives human-in-the-loop steps room to breathe.
    AGENT_STEP_TIMEOUT: int = 3600  # seconds for a full agent step (LLM + browser action)

    # How long the agent waits for the user to respond to an in-run prompt — an OTP /
    # verification code, sign-in credentials, or a confirm-before-ordering question —
    # before giving up and moving on. Generous so a request can sit until the user is
    # back at the screen; they can always Stop to abort sooner.
    HUMAN_INPUT_TIMEOUT: int = 3600  # seconds (1 hour)

    # Ollama generation options for the agent's structured output.
    # num_ctx: context window. The Ollama default (~4096) is smaller than
    #   browser-use's prompt (instructions + page DOM), so it truncates the prompt
    #   and the model can't follow the action format — the agent stalls at 0 steps.
    #   8192 fits typical pages; raising it costs VRAM (more CPU spill = slower).
    # num_predict: max tokens generated per step. An action JSON is small, so this
    #   just caps runaway output; lower = faster worst case.
    OLLAMA_NUM_CTX: int = 8192
    OLLAMA_NUM_PREDICT: int = 2048

    # xAI / Grok (OpenAI-compatible API). Key is supplied per-run from the UI.
    XAI_BASE_URL: str = "https://api.x.ai/v1"

    # OpenAI (native). Key is supplied per-run from the UI.
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./vellam.db"

    # Credential vault — site logins encrypted at rest (Windows DPAPI, bound to the
    # OS user). Stored here, never in the browser; the model only sees placeholders.
    VAULT_FILE: str = "vault.enc"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3500",
        "http://127.0.0.1:3500",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/app.log"

    # Browser
    BROWSER_HEADLESS: bool = False
    # Path to the Chromium-based browser executable the agent should drive. Empty
    # means "let browser_use find one" (installed Chrome, or a Playwright-managed
    # Chromium). The desktop build sets VELLAM_BROWSER_EXECUTABLE_PATH to the
    # Chromium it ships, so automation never depends on the user having Chrome
    # installed and doesn't rely on browser_use's path-guessing (whose Windows
    # pattern expects `chrome-win`, while modern Playwright uses `chrome-win64`).
    BROWSER_EXECUTABLE_PATH: str = ""
    # Chromium UI/Accept-Language locale — drives how sites localize content and,
    # importantly, which currency travel/shopping sites default to.
    BROWSER_LOCALE: str = "en-IN"
    # The currency the agent must report all prices in (sites often default to the
    # wrong one, e.g. GBP). Shown to the model in its instructions.
    AGENT_CURRENCY: str = "INR (₹, Indian Rupees)"

    # File uploads
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 20

    @field_validator("DEBUG", "BROWSER_HEADLESS", mode="before")
    @classmethod
    def _strip_bool(cls, v):
        """Tolerate whitespace around boolean env values.

        Windows `set VELLAM_DEBUG=false && ...` stores "false " (trailing
        space), which pydantic otherwise rejects, crashing startup. Strip first.
        """
        return v.strip() if isinstance(v, str) else v

    @property
    def upload_path(self) -> Path:
        path = Path(self.UPLOAD_DIR)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def log_path(self) -> Path:
        path = Path(self.LOG_FILE).parent
        path.mkdir(parents=True, exist_ok=True)
        return Path(self.LOG_FILE)


settings = Settings()
