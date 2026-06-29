"""
Action executor — translates parsed agent actions into real observations.
Browser actions use Playwright via BrowserController (Part 3).
"""

import asyncio
from typing import Any, Optional

import httpx

from app.browser.controller import BrowserController
from app.core.logging import get_logger

logger = get_logger(__name__)


class ActionExecutor:
    def __init__(self):
        self._browser: Optional[BrowserController] = None
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            follow_redirects=True,
            headers={"User-Agent": "Vellam/0.1"},
        )

    async def start_browser(self) -> None:
        self._browser = BrowserController()
        await self._browser.start()
        logger.info("browser_ready")

    async def close(self) -> None:
        if self._browser:
            await self._browser.stop()
        if not self._http.is_closed:
            await self._http.aclose()

    async def execute(self, action: str, action_input: dict[str, Any]) -> str:
        handler = {
            "navigate":     self._navigate,
            "search":       self._search,
            "click":        self._click,
            "type":         self._type,
            "extract":      self._extract,
            "scroll":       self._scroll,
            "wait":         self._wait,
            "think":        self._think,
        }.get(action)

        if handler is None:
            return f"Unknown action '{action}'."
        try:
            return await handler(action_input)
        except Exception as exc:
            logger.warning("action_error", action=action, error=str(exc))
            return f"Action '{action}' failed: {exc}"

    # ── Browser actions ───────────────────────────────────────────────

    async def _ensure_browser(self) -> str | None:
        """Start browser on first use."""
        if not self._browser or not self._browser.started:
            await self.start_browser()
        return None

    async def _navigate(self, inp: dict) -> str:
        url = inp.get("url", "").strip()
        if not url:
            return "Error: navigate requires a 'url' field."
        await self._ensure_browser()
        return await self._browser.navigate(url)

    async def _search(self, inp: dict) -> str:
        query = inp.get("query", "").strip()
        if not query:
            return "Error: search requires a 'query' field."
        engine = inp.get("engine", "google").lower()
        await self._ensure_browser()
        return await self._browser.search(query, engine)

    async def _click(self, inp: dict) -> str:
        desc = inp.get("description", inp.get("text", "")).strip()
        selector = inp.get("selector", "")
        if not desc and not selector:
            return "Error: click requires a 'description' or 'selector'."
        await self._ensure_browser()
        return await self._browser.click(desc, selector)

    async def _type(self, inp: dict) -> str:
        desc = inp.get("description", inp.get("field", "")).strip()
        text = inp.get("text", "").strip()
        selector = inp.get("selector", "")
        press_enter = inp.get("press_enter", False)
        if not text:
            return "Error: type requires a 'text' field."
        await self._ensure_browser()
        return await self._browser.type_text(desc or "input field", text, selector, press_enter)

    async def _extract(self, inp: dict) -> str:
        desc = inp.get("description", "page content")
        await self._ensure_browser()
        return await self._browser.extract(desc)

    async def _scroll(self, inp: dict) -> str:
        direction = inp.get("direction", "down")
        amount = int(inp.get("amount", 3))
        await self._ensure_browser()
        return await self._browser.scroll(direction, amount)

    # ── Non-browser actions ───────────────────────────────────────────

    async def _wait(self, inp: dict) -> str:
        seconds = min(int(inp.get("seconds", 2)), 8)
        reason = inp.get("reason", "")
        await asyncio.sleep(seconds)
        return f"Waited {seconds}s. {reason}".strip()

    async def _think(self, inp: dict) -> str:
        return f"Thought recorded: {inp.get('reasoning', '')}"
