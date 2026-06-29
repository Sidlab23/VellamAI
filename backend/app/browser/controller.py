"""
Playwright browser controller — connects to Browser Use Cloud via CDP.
One instance per agent task — start once, reuse across all steps, stop when done.
Stealth, anti-fingerprinting, and residential proxies are handled by the cloud.
"""

import asyncio
from typing import Optional
from urllib.parse import quote_plus

from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Page,
    Playwright,
    TimeoutError as PWTimeout,
)

from app.browser.extractor import (
    extract_page_content,
    extract_search_results,
    extract_product_listings,
)
from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_COOKIE_SELECTORS = [
    "#onetrust-accept-btn-handler",
    "button[id*='accept' i]",
    "button[class*='accept' i]",
    "button[class*='cookie' i]",
    "[aria-label*='Accept' i]",
    "[aria-label*='accept cookies' i]",
    "[data-testid*='cookie-accept' i]",
    ".cookie-consent__accept",
    "#cookie-consent-accept",
]


class BrowserController:
    def __init__(self, headless: bool = False, slow_mo: int = 80):
        # headless/slow_mo ignored — cloud browser handles display
        self._pw: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self.current_url: str = ""
        self.started: bool = False

    async def start(self) -> None:
        api_key = settings.BROWSER_USE_API_KEY
        if not api_key:
            raise RuntimeError(
                "BROWSER_USE_API_KEY is not set. "
                "Get a key at https://cloud.browser-use.com/settings and add it to .env"
            )

        country = settings.BROWSER_USE_PROXY_COUNTRY or "us"
        wss_url = (
            f"wss://connect.browser-use.com"
            f"?apiKey={api_key}"
            f"&proxyCountryCode={country}"
        )

        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.connect_over_cdp(wss_url)
        logger.info("browser_cloud_connected", proxy_country=country)

        # CDP gives us an existing context and page from the cloud browser
        if self._browser.contexts:
            self._context = self._browser.contexts[0]
        else:
            self._context = await self._browser.new_context()

        if self._context.pages:
            self._page = self._context.pages[0]
        else:
            self._page = await self._context.new_page()

        self._page.set_default_timeout(20000)
        self.started = True

    async def stop(self) -> None:
        try:
            if self._browser:
                await self._browser.close()  # disconnects WebSocket → stops cloud session
            if self._pw:
                await self._pw.stop()
        except Exception:
            pass
        self.started = False
        logger.info("browser_cloud_disconnected")

    # ── Actions ───────────────────────────────────────────────────────

    async def navigate(self, url: str) -> str:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        try:
            logger.info("navigate", url=url)
            await self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await self._settle()
            await self._dismiss_overlays()
            self.current_url = self._page.url
            title = await self._page.title()
            content = await extract_page_content(self._page)
            return f"Navigated to: {self.current_url}\nTitle: {title}\n\n{content}"
        except PWTimeout:
            return f"Timed out loading {url}. Page may have loaded partially. Current URL: {self._page.url}"
        except Exception as e:
            return f"Navigation error: {e}"

    async def search(self, query: str, engine: str = "google") -> str:
        urls = {
            "google":     f"https://www.google.com/search?q={quote_plus(query)}",
            "duckduckgo": f"https://duckduckgo.com/?q={quote_plus(query)}&ia=web",
            "bing":       f"https://www.bing.com/search?q={quote_plus(query)}",
            "amazon":     f"https://www.amazon.com/s?k={quote_plus(query)}",
        }
        url = urls.get(engine.lower(), urls["google"])
        try:
            logger.info("search", query=query, engine=engine)
            await self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await self._settle()
            await self._dismiss_overlays()
            self.current_url = self._page.url
            result = await extract_search_results(self._page, engine)
            return result or await extract_page_content(self._page)
        except Exception as e:
            return f"Search failed ({engine}, '{query}'): {e}"

    async def click(self, description: str, selector: str = "") -> str:
        try:
            el = await self._find_element(description, selector)
            if not el:
                return f"Could not find element matching '{description}' on the page."
            await el.scroll_into_view_if_needed()
            await el.click(timeout=8000)
            await self._settle()
            self.current_url = self._page.url
            return f"Clicked '{description}'. Now on: {self.current_url}"
        except Exception as e:
            return f"Click failed ('{description}'): {e}"

    async def type_text(self, description: str, text: str, selector: str = "", press_enter: bool = False) -> str:
        try:
            el = await self._find_element(description, selector, prefer_input=True)
            if not el:
                return f"Could not find input field '{description}'."
            await el.scroll_into_view_if_needed()
            await el.click()
            await el.triple_click()
            await el.type(text, delay=40)
            if press_enter:
                await el.press("Enter")
                await self._settle()
            return f"Typed '{text[:60]}' into '{description}'." + (" Pressed Enter." if press_enter else "")
        except Exception as e:
            return f"Type failed ('{description}'): {e}"

    async def extract(self, description: str) -> str:
        try:
            listings = await extract_product_listings(self._page)
            if listings and len(listings) > 100:
                return listings
            return await extract_page_content(self._page)
        except Exception as e:
            return f"Extract failed: {e}"

    async def scroll(self, direction: str = "down", amount: int = 3) -> str:
        try:
            px = amount * 500 * (-1 if direction == "up" else 1)
            await self._page.evaluate(f"window.scrollBy(0, {px})")
            await asyncio.sleep(0.8)
            return f"Scrolled {direction}. Current URL: {self._page.url}"
        except Exception as e:
            return f"Scroll failed: {e}"

    async def screenshot(self) -> bytes:
        return await self._page.screenshot(type="png", full_page=False)

    # ── Helpers ───────────────────────────────────────────────────────

    async def _settle(self, timeout: int = 4000) -> None:
        try:
            await self._page.wait_for_load_state("networkidle", timeout=timeout)
        except PWTimeout:
            pass
        await asyncio.sleep(0.4)

    async def _dismiss_overlays(self) -> None:
        for sel in _COOKIE_SELECTORS:
            try:
                el = await self._page.query_selector(sel)
                if el and await el.is_visible():
                    await el.click(timeout=2000)
                    await asyncio.sleep(0.4)
                    logger.info("overlay_dismissed", selector=sel)
                    return
            except Exception:
                continue

    async def _find_element(self, description: str, selector: str = "", prefer_input: bool = False):
        page = self._page

        # 1. Explicit CSS selector
        if selector:
            try:
                el = await page.query_selector(selector)
                if el and await el.is_visible():
                    return el
            except Exception:
                pass

        # 2. Placeholder text (for inputs)
        if prefer_input:
            try:
                loc = page.get_by_placeholder(description, exact=False)
                if await loc.first.is_visible():
                    return await loc.first.element_handle()
            except Exception:
                pass

        # 3. Exact text / partial text
        try:
            loc = page.get_by_text(description, exact=False)
            if await loc.first.is_visible():
                return await loc.first.element_handle()
        except Exception:
            pass

        # 4. Role-based (button / link)
        if not prefer_input:
            for role in ("button", "link"):
                try:
                    loc = page.get_by_role(role, name=description)  # type: ignore
                    if await loc.first.is_visible():
                        return await loc.first.element_handle()
                except Exception:
                    pass

        # 5. Common input fallbacks
        if prefer_input:
            for sel in ('input[type="search"]', 'input[type="text"]', "textarea"):
                try:
                    el = await page.query_selector(sel)
                    if el and await el.is_visible():
                        return el
                except Exception:
                    pass

        return None
