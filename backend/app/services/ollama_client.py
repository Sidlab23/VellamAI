"""
Async wrapper around the Ollama HTTP API.

All LLM inference in Vellam goes through this module.
Website content passed to generate() must be pre-wrapped in [UNTRUSTED WEBPAGE CONTENT]
tags by the caller — this module does not sanitize prompts, it just talks to Ollama.
"""

from typing import AsyncGenerator, Optional
import httpx

from app.config import settings
from app.core.exceptions import OllamaConnectionError, OllamaModelError
from app.core.logging import get_logger

logger = get_logger(__name__)


class OllamaClient:
    def __init__(
        self,
        base_url: str = settings.OLLAMA_BASE_URL,
        timeout: int = settings.OLLAMA_TIMEOUT,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout),
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ------------------------------------------------------------------
    # Health / discovery
    # ------------------------------------------------------------------

    async def is_available(self) -> bool:
        try:
            client = await self._get_client()
            response = await client.get("/api/tags", timeout=5.0)
            return response.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        """Return the list of locally pulled Ollama models."""
        try:
            client = await self._get_client()
            response = await client.get("/api/tags")
            response.raise_for_status()
            return response.json().get("models", [])
        except httpx.ConnectError as exc:
            raise OllamaConnectionError() from exc

    async def model_exists(self, model: str) -> bool:
        models = await self.list_models()
        names = [m.get("name", "").split(":")[0] for m in models]
        return model.split(":")[0] in names

    async def get_capabilities(self, model: str) -> list[str]:
        """Return a model's capability tags (e.g. ['completion', 'vision', 'tools']).

        Uses /api/show. Returns [] on any error so callers can treat "unknown" as
        "not capable" without special-casing failures.
        """
        try:
            client = await self._get_client()
            response = await client.post("/api/show", json={"model": model}, timeout=10.0)
            if response.status_code != 200:
                return []
            return response.json().get("capabilities", []) or []
        except Exception:
            return []

    async def list_vision_models(self, preferred: Optional[str] = None) -> list[str]:
        """All locally installed vision-capable models, `preferred` first.

        The CAPTCHA solver tries them in order: the task's own model first (no
        extra model load), then others as fallbacks, since small models often
        can't read distorted text that a larger one can.
        """
        ordered: list[str] = []
        if preferred and "vision" in await self.get_capabilities(preferred):
            ordered.append(preferred)
        try:
            for m in await self.list_models():
                name = m.get("name") or m.get("model") or ""
                if name and name not in ordered and "vision" in await self.get_capabilities(name):
                    ordered.append(name)
        except Exception:
            pass
        return ordered

    async def find_vision_model(self, preferred: Optional[str] = None) -> Optional[str]:
        """First locally available vision-capable model (preferred first), or None."""
        models = await self.list_vision_models(preferred)
        return models[0] if models else None

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    async def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        system: Optional[str] = None,
        temperature: float = 0.2,
        stream: bool = False,
        format: Optional[str] = None,
        think: Optional[bool] = None,
        images: Optional[list[str]] = None,
    ) -> str:
        """Single-turn generation. Returns the full response string.

        think=False disables chain-of-thought on thinking models (qwen3, deepseek-r1...).
        Required when combining a thinking model with format="json" — otherwise the
        response field comes back empty. Non-thinking models ignore the flag.

        images: optional list of base64-encoded images (no data: prefix) for
        vision models — used by the CAPTCHA solver to read a screenshot.
        """
        resolved_model = model or settings.OLLAMA_DEFAULT_MODEL

        payload: dict = {
            "model": resolved_model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": temperature},
        }
        if system:
            payload["system"] = system
        if format:
            payload["format"] = format
        if think is not None:
            payload["think"] = think
        if images:
            payload["images"] = images

        try:
            client = await self._get_client()
            response = await client.post("/api/generate", json=payload)
            if response.status_code == 404:
                raise OllamaModelError(resolved_model)
            response.raise_for_status()
            return response.json().get("response", "")
        except httpx.ConnectError as exc:
            raise OllamaConnectionError() from exc

    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: float = 0.2,
    ) -> str:
        """
        Multi-turn chat endpoint.
        messages format: [{"role": "system"|"user"|"assistant", "content": "..."}]
        """
        resolved_model = model or settings.OLLAMA_DEFAULT_MODEL

        payload = {
            "model": resolved_model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }

        try:
            client = await self._get_client()
            response = await client.post("/api/chat", json=payload)
            if response.status_code == 404:
                raise OllamaModelError(resolved_model)
            response.raise_for_status()
            data = response.json()
            return data.get("message", {}).get("content", "")
        except httpx.ConnectError as exc:
            raise OllamaConnectionError() from exc

    async def stream_generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        system: Optional[str] = None,
        temperature: float = 0.2,
    ) -> AsyncGenerator[str, None]:
        """Streaming generation — yields token chunks as they arrive."""
        import json

        resolved_model = model or settings.OLLAMA_DEFAULT_MODEL
        payload: dict = {
            "model": resolved_model,
            "prompt": prompt,
            "stream": True,
            "options": {"temperature": temperature},
        }
        if system:
            payload["system"] = system

        try:
            client = await self._get_client()
            async with client.stream("POST", "/api/generate", json=payload) as response:
                if response.status_code == 404:
                    raise OllamaModelError(resolved_model)
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        chunk = json.loads(line)
                        if token := chunk.get("response"):
                            yield token
                        if chunk.get("done"):
                            break
        except httpx.ConnectError as exc:
            raise OllamaConnectionError() from exc


# Module-level singleton
ollama_client = OllamaClient()
