"""
Agent loop using browser-use (local) + Ollama.
Keeps the same ReactLoop interface so agent_service.py is unchanged.

On Windows, uvicorn's event loop does not support subprocess creation
(asyncio.SelectorEventLoop raises NotImplementedError for create_subprocess_exec).
browser-use needs to launch Chromium via subprocess, so we run agent.run() in a
dedicated thread with asyncio.run() which always creates a ProactorEventLoop on Windows.
Async callbacks are bridged back to the FastAPI loop via run_coroutine_threadsafe().
"""

import asyncio
import concurrent.futures
import json
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from browser_use import ActionResult, Agent, Tools
from browser_use.browser.profile import BrowserProfile
from browser_use.llm import ChatOllama, ChatOpenAI
from browser_use.llm.exceptions import ModelProviderError
from browser_use.llm.ollama.serializer import OllamaMessageSerializer
from browser_use.llm.views import ChatInvokeCompletion

from app.agent import ask_gate, cred_gate, otp_gate
from app.config import settings
from app.core.logging import get_logger
from app.models.task import Task, TaskStatus
from app.services import vault_service
from app.services.ollama_client import OllamaClient
from app.services.task_service import TaskService

# Appended to every agent task so the model knows to ask the user for OTP codes
# instead of guessing them.
_OTP_INSTRUCTIONS = (
    "\n\nIMPORTANT — verification codes: If a website requires a one-time password "
    "(OTP), an SMS or email verification code, or a 2FA code to continue (for example "
    "during login, checkout, or payment), do NOT invent or guess it. Call the "
    "request_otp_code action with a short reason describing what the code is for; the "
    "user will receive the code on their device and provide it back to you. Then type "
    "that exact code into the verification field on the page and continue."
)

# Appended so the agent treats signing in as the FIRST main step for anything that
# happens inside the user's own account (buying/checkout, placing an order, applying
# to a job, posting). Saved credentials arrive as browser-use sensitive_data: the
# model sees placeholder names like "<site>_username" / "<site>_password" scoped to a
# domain. If none exist for the site it must NOT push ahead unauthenticated — it asks
# the user for them via the request_credentials tool, which also saves them safely.
_LOGIN_INSTRUCTIONS = (
    "\n\nSigning in — DO THIS FIRST: If the task requires acting inside the user's own "
    "account on a website — making a purchase or going through checkout, placing or "
    "confirming an order, applying to a job, or posting/submitting anything that needs "
    "you to be signed in — then LOGGING IN IS THE FIRST MAIN STEP. Go to the site and "
    "sign in BEFORE searching, adding items to a cart, or filling forms. Do not leave "
    "login until checkout.\n"
    "Use the user's saved credentials: they are provided to you as sensitive-data "
    "placeholders for specific sites (for example <site>_username and <site>_password). "
    "On the matching site, type those placeholders into the login fields to sign in.\n"
    "If you need to sign in to a site but NO credentials are available for it, do NOT "
    "guess, do NOT create a new account, and do NOT continue unauthenticated. Call the "
    "request_credentials action with the site (its domain or name) and a short reason. "
    "The user will securely save and provide the username and password; use the values "
    "it returns to log in, then continue the task."
)

# Appended so a purchase is carried all the way through (to actually exercise the
# checkout/OTP flow), so the cart is cleaned of any pre-existing items the user did
# NOT ask for before ordering, and so the agent ASKS before abandoning the task on a
# price or constraint wall instead of returning a "partial completion" and stopping.
_PURCHASE_INSTRUCTIONS = (
    "\n\nCompleting a purchase or order: When the task is to buy/order something, carry "
    "the flow all the way through — sign in first, find a product that matches the "
    "user's constraints, ADD IT TO THE CART, and PROCEED TO CHECKOUT and place the "
    "order. Placing an order often needs a verification code; when the site asks for "
    "one, use request_otp_code. Do not stop at the search results.\n"
    "CART HYGIENE — CRITICAL, the order must contain ONLY what this task asked for: the "
    "user's cart may already hold unrelated items from before. After signing in and "
    "BEFORE you add the new product, OPEN THE CART and REMOVE every item already in it "
    "(use each item's Delete/Remove link until the cart is empty). Only then add the "
    "product for this task. As a final safety check, on the order-review/checkout page "
    "confirm the cart contains ONLY this task's item at the right quantity — if anything "
    "else is present, remove it before placing the order. NEVER place an order that "
    "includes items you did not add for this task.\n"
    "ITEM MISSING FROM THE ACTIVE CART — RECOVER IT ON THE SPOT, DON'T HUNT: After you "
    "add the product, head straight for checkout. If the active cart then looks empty or "
    "the item isn't in it, do NOT waste steps re-searching the site or browsing around "
    "for the product. Two cheap fixes, in order: (1) Amazon often drops a just-added "
    "item into a 'Saved for later' section further down the SAME cart page — if you see "
    "it there, click its 'Move to cart' / 'Add to cart' button right there. (2) "
    "Otherwise the cart may have just rendered blank for a moment, or the add didn't "
    "register — reload the cart once, and if the item is still missing, simply ADD THE "
    "SAME PRODUCT TO THE CART AGAIN and continue. Re-adding is far cheaper than hunting "
    "for it. If re-adding leaves the quantity higher than the user asked for, set the "
    "quantity correctly on the cart/checkout page before ordering.\n"
    "CHOOSE PAYMENT — ASK ONCE THE PRODUCT IS IN THE CART: If the user already said how "
    "to pay (e.g. 'use UPI' or 'cash on delivery'), use that and do not ask. Otherwise, "
    "as soon as this task's product is in the cart, call ask_user — name the product and "
    "its price, and set options to EXACTLY ['UPI', 'Cash on Delivery'] (you may add a "
    "'Cancel purchase' option). Use the method the user picks when you reach the payment "
    "step. This is separate from the final go-ahead below — you must STILL run the "
    "confirm-before-ordering check right before placing the order.\n"
    "CONFIRM BEFORE ORDERING — REQUIRED: Placing the order is irreversible, so you MUST "
    "get the user's explicit go-ahead first. Immediately before the final 'Place "
    "order'/'Buy now'/'Pay' click, call ask_user with a question that states EXACTLY "
    "what you are about to order — the product name(s), the quantity, and the order "
    "total — and set options to exactly ['Yes, place the order', 'No, do not order']. "
    "Place the order ONLY if the user answers 'Yes, place the order'. If the user picks "
    "'No, do not order' (or does not answer), do NOT place the order — stop and report "
    "what you would have ordered. Always run this confirmation, even if the user "
    "approved something earlier.\n"
    "If a constraint blocks you (DO NOT just give up or return a partial result): the "
    "most common case is price. If you cannot find any product within the user's price "
    "range (or another stated constraint), call ask_user to ask whether to relax it. "
    "For a price limit, ask if you may increase the budget and offer concrete options "
    "(for example the next price tiers and a 'No price limit' option) plus a 'Cancel "
    "purchase' option. Then continue using the user's answer — only stop early if the "
    "user chooses to cancel.\n"
    "Spend your steps on reaching cart and checkout rather than re-searching; if you "
    "are running low on steps, prioritise adding to cart and starting checkout."
)

# Appended so the model uses the CAPTCHA solver instead of stalling on a challenge.
_CAPTCHA_INSTRUCTIONS = (
    "\n\nCAPTCHAs: If a page shows a simple text/image CAPTCHA — a small picture of "
    "distorted or obscured letters and/or numbers you must retype — call the "
    "solve_captcha action. It reads the CAPTCHA and returns the characters; type that "
    "exact text into the CAPTCHA input field, then continue. Only use it for readable "
    "text/image CAPTCHAs. Do NOT use it for reCAPTCHA/hCaptcha 'I'm not a robot' "
    "checkboxes or 'select all images with…' grid challenges — those can't be read as "
    "text; for those, try clicking the checkbox normally or ask the user for help."
)

# Appended so the agent actually COMMITS values into fields. Typing a city/airport
# into an autocomplete and moving on without picking the suggestion is a very common
# failure where the field ends up empty (e.g. "selected Bangalore but never entered it").
_FORM_INSTRUCTIONS = (
    "\n\nFilling fields & dropdowns — MAKE THE VALUE STICK (common failure): typing "
    "text alone is often NOT enough. For an autocomplete / typeahead field (city, "
    "airport, location, address, product search), after you type, a list of suggestions "
    "drops down — you MUST then CLICK the matching suggestion (or press Enter to accept "
    "the highlighted one) so the value is actually committed. Do not type 'Bangalore' "
    "and walk away — pick it from the dropdown. For a native select, choose the option "
    "explicitly. After entering OR selecting ANY value, LOOK at that field in the page "
    "screenshot and confirm it now shows what you intended BEFORE moving to the next "
    "field or clicking Search/Continue; if it is blank or wrong, re-enter it and pick "
    "the suggestion again. Never submit a form whose key fields are still empty. Be "
    "efficient: type -> pick the suggestion -> verify on screen -> move on; don't "
    "re-search or rebuild pages you have already filled."
)

# Appended so the agent doesn't blindly default to one retailer. Without this it
# tends to open Amazon first for almost any request; it must instead pick sources
# based on what the user actually asked for.
_SOURCE_INSTRUCTIONS = (
    "\n\nChoosing where to look: Do NOT default to Amazon — or any single site — "
    "as your first move. Unless the user explicitly names a website, START with a "
    "general web search (e.g. Google) and then pick the most relevant, trustworthy "
    "sources for THIS specific request. For products or prices, compare across "
    "several retailers rather than only one. Go straight to a particular site only "
    "when the user asked for it by name."
)

# Appended so the final answer is skimmable: bullet points instead of a wall of
# text, and a real list whenever the user asks for items.
_OUTPUT_FORMAT_INSTRUCTIONS = (
    "\n\nFormatting your final answer (when you call done): Write clean Markdown, "
    "structured so the single best choice is obvious:\n"
    "1. Lead with ONE recommendation as a heading EXACTLY like "
    "'## ✅ Recommended: <name>', then 1-2 short lines on WHY it wins (price, "
    "rating, fit for the request).\n"
    "2. Then a heading '## Other options' listing the remaining choices — one per "
    "line as bullets ('- ') or numbered ('1.'), each with key details (name, "
    "price, source, a short pro/con).\n"
    "Always choose a single best option even if the user didn't explicitly ask, "
    "then show the alternatives below it. Never return one long paragraph; keep "
    "sentences short. If the task isn't about choosing between options, still lead "
    "with the key answer first, then supporting details as bullets."
)

# Appended so prices come back in the user's currency. Sites frequently default
# to the wrong one (e.g. GBP for an India route); make the agent fix that.
_CURRENCY_INSTRUCTIONS = (
    "\n\nCurrency: Report ALL monetary amounts in the user's local currency, "
    f"{settings.AGENT_CURRENCY}. If a website shows prices in a different currency, "
    f"change the site's country/currency setting to {settings.AGENT_CURRENCY} (or "
    "convert the amounts) and present every price in that currency only. Never leave "
    "prices in a foreign currency."
)

# Instruction given to the vision model when reading a CAPTCHA screenshot.
_CAPTCHA_VISION_PROMPT = (
    "This image is a screenshot of a web page that contains a CAPTCHA — a short string "
    "of distorted or obscured characters (letters and/or digits) the user must retype. "
    "Read the CAPTCHA and output ONLY those characters, exactly as shown: no spaces, no "
    "quotes, no explanation, no extra words. Preserve capitalization. If you cannot find "
    "a readable text CAPTCHA in the image, output exactly: NONE"
)


def _parse_captcha_answer(raw: str) -> str:
    """Extract the CAPTCHA solution from a vision model's reply.

    Vision models sometimes wrap the answer ("The code is: AB12C.") or decline
    ("NONE"). This pulls out the bare token and rejects verbose/empty replies so
    the caller can fall back to asking the user.
    """
    s = (raw or "").strip()
    if not s:
        return ""
    s = s.splitlines()[0].strip()          # first line only
    if ":" in s:
        s = s.split(":")[-1].strip()       # drop "Answer:"-style prefixes
    s = s.strip("\"'`.,!? ").strip()
    if not s or s.upper() == "NONE":
        return ""
    # Real text CAPTCHAs are short; a long/multi-word reply means it failed to read one.
    if len(s) > 16 or len(s.split()) > 1:
        return ""
    return s


async def _read_captcha_from_screenshot(image_b64: str, preferred_model: str) -> str:
    """Ask a local Ollama vision model to read a CAPTCHA from a screenshot.

    Creates its own OllamaClient so the underlying httpx client is bound to the
    agent worker thread's event loop (the shared singleton is bound to the FastAPI
    loop and can't be reused here). Returns "" if no vision model is available or
    the CAPTCHA can't be read.
    """
    client = OllamaClient()
    try:
        models = await client.list_vision_models(preferred_model)
        if not models:
            logger.info("captcha_no_vision_model", preferred=preferred_model)
            return ""
        # Try each vision model until one reads the CAPTCHA — small models (e.g.
        # gemma 4 e4b) often return NONE where a larger one (qwen) succeeds.
        for model in models:
            try:
                raw = await client.generate(
                    prompt=_CAPTCHA_VISION_PROMPT,
                    model=model,
                    images=[image_b64],
                    temperature=0.0,
                    think=False,
                )
            except Exception as exc:
                logger.warning("captcha_vision_error", model=model, error=str(exc))
                continue
            answer = _parse_captcha_answer(raw)
            logger.info("captcha_vision_read", model=model, solved=bool(answer))
            if answer:
                return answer
        return ""
    finally:
        await client.close()


@dataclass
class _SimpleJsonChatOllama(ChatOllama):
    """
    Replaces Ollama's schema-constrained structured output with simple JSON mode.

    The default ChatOllama passes the full 20 KB AgentOutput JSON schema to Ollama
    via `format=schema`.  For small models (≤7 B params) this grammar is so complex
    that Ollama returns just `{`, causing a parse failure on every step and
    the agent exits after max_failures with 0 steps taken.

    Using `format="json"` (plain JSON mode) lets the model follow the JSON
    structure described in the browser-use system prompt instead, which works
    reliably with llama3.2 and other compact Ollama models.

    `think=False` is also critical: thinking models (qwen3, deepseek-r1...)
    combined with `format=json` route all their tokens into a hidden reasoning
    block and return an empty `{}` body, which fails AgentOutput validation
    ("action Field required"). Disabling thinking forces the model to put its
    reasoning into the JSON fields (thinking / evaluation / memory) instead.
    Non-thinking models ignore the flag.
    """

    async def ainvoke(self, messages: list, output_format=None, **kwargs: Any):
        ollama_messages = OllamaMessageSerializer.serialize_messages(messages)

        # Plain-text path (no structured output requested)
        if output_format is None:
            try:
                response = await self.get_client().chat(
                    model=self.model,
                    messages=ollama_messages,
                    think=False,
                    options=self.ollama_options,
                )
                return ChatInvokeCompletion(completion=response.message.content or '', usage=None)
            except Exception as exc:
                raise ModelProviderError(message=str(exc), model=self.name) from exc

        # Structured path: small models intermittently emit truncated JSON
        # (just "{" or "{}"). Retry a few times before giving up — a fresh
        # sample usually parses cleanly. Temperatures vary per attempt: 0.0 is
        # the most reliable single shot, but being deterministic it repeats the
        # same failure, so later retries raise temperature to draw a different
        # sample.
        retry_temps = [0.0, 0.4]
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                options = dict(self.ollama_options or {})
                if attempt > 0:
                    options["temperature"] = retry_temps[attempt - 1]
                response = await self.get_client().chat(
                    model=self.model,
                    messages=ollama_messages,
                    format='json',
                    think=False,
                    options=options,
                )
                raw = (response.message.content or '').strip()
                if len(raw) < 2 or raw in ('{}', '{'):
                    raise ValueError(f"model returned incomplete JSON: {raw!r}")
                completion = output_format.model_validate_json(raw)
                return ChatInvokeCompletion(completion=completion, usage=None)
            except Exception as exc:
                last_error = exc

        raise ModelProviderError(
            message=(
                f"{last_error} — the model failed to produce valid JSON after 3 tries. "
                "This usually means the model is too small for structured browser control; "
                "try llama3.1:8b or qwen2.5:7b."
            ),
            model=self.name,
        ) from last_error

logger = get_logger(__name__)


def _readable_domain(pattern: str) -> str:
    """Turn a sensitive_data domain pattern into a plain site name for the prompt.

    e.g. "https://*.amazon.in" -> "amazon.in". Used only to tell the agent WHICH
    sites it has saved credentials for — never the credential values themselves.
    """
    d = (pattern or "").split("://", 1)[-1]
    if d.startswith("*."):
        d = d[2:]
    return d.strip("/")


def _credential_sites_hint(sensitive_data: dict | None) -> str:
    """Non-secret note listing sites the user has saved credentials for.

    Credentials are stored as { "<domain pattern>": {placeholder: value} }; service
    API keys are flat string entries. We surface only the dict-valued (domain) keys
    so the agent knows to sign in there instead of wrongly asking for credentials.
    """
    sites = sorted({
        _readable_domain(k)
        for k, v in (sensitive_data or {}).items()
        if isinstance(v, dict)
    })
    sites = [s for s in sites if s]
    if not sites:
        return ""
    return (
        "\n\nYou already have the user's saved login credentials for these sites: "
        + ", ".join(sites)
        + ". When the task needs you to sign in to one of them, go to that site and "
        "log in using the provided sensitive-data placeholders (visible once you are "
        "on the site) - do NOT use request_credentials for these; only use it for a "
        "site that is NOT in this list."
    )


def _profile_hint() -> str:
    """The user's saved profile as a short note for the model (their local 'memory').

    Per-run dynamic content — kept in the task message, NOT the cached system prompt.
    """
    try:
        p = vault_service.get_profile()
    except Exception:
        return ""
    fields = [
        ("name", "Name"), ("email", "Email"), ("phone", "Phone"),
        ("city", "City"), ("address", "Address"),
    ]
    lines = [f"- {label}: {p[key].strip()}"
             for key, label in fields
             if isinstance(p.get(key), str) and p[key].strip()]
    if not lines:
        return ""
    return (
        "\n\nWhat you know about the user (use this to fill forms, pick sizes, choose "
        "delivery and respect their preferences — but never override an explicit "
        "instruction in the task):\n" + "\n".join(lines)
    )


def _now_and_locale_hint() -> str:
    """Current local date/time + the user's region, from the system clock and locale.

    Fully offline (no GPS, nothing leaves the machine). Per-run dynamic — kept in the
    task message, not the cached system prompt.
    """
    now = datetime.now().astimezone()
    off = now.strftime("%z")  # e.g. +0530
    off_fmt = f"UTC{off[:3]}:{off[3:]}" if len(off) == 5 else "UTC"
    tzname = now.tzname() or ""
    locale = settings.BROWSER_LOCALE
    region = locale.split("-")[-1] if "-" in locale else locale
    return (
        "\n\nCurrent context (the user's machine, offline): local date & time is "
        f"{now.strftime('%A, %d %B %Y, %H:%M')} ({off_fmt}{', ' + tzname if tzname else ''}). "
        f"User locale {locale}; treat the user as located in region {region}. Use this "
        "for anything time- or location-dependent (today's date, delivery estimates, "
        "opening hours, choosing regional sites and currency)."
    )


def is_grok_model(model: str) -> bool:
    """Grok / xAI models are routed to the OpenAI-compatible xAI endpoint."""
    return model.lower().startswith("grok")


def is_openai_model(model: str) -> bool:
    """Native OpenAI models: gpt-*, chatgpt-*, and the o1/o3/o4 reasoning family."""
    return model.lower().strip().startswith(("gpt", "chatgpt", "o1", "o3", "o4"))


def _is_openai_reasoning(model: str) -> bool:
    """o-series reasoning models only accept the default temperature (1.0)."""
    return model.lower().strip().startswith(("o1", "o3", "o4"))


def _model_supports_vision(model: str) -> bool:
    """Whether to feed the model page SCREENSHOTS (vision) alongside the DOM.

    Vision hugely improves how well the agent 'reads' a page — it sees text the DOM
    doesn't expose (image/canvas-rendered content, sparse SPA DOMs) instead of acting
    blind. We only enable it for genuinely multimodal models, though: sending images
    to a text-only model errors or is silently ignored.
    """
    m = (model or "").lower().strip()
    if is_grok_model(m):
        # grok-4.x is multimodal; older grok-2/3 text models are not.
        return m.startswith(("grok-4", "grok4")) or "vision" in m
    if is_openai_model(m):
        # Modern OpenAI families are multimodal; exclude the known text-only ones.
        if m.startswith(("gpt-3.5", "gpt-35", "o1-mini", "o3-mini")):
            return False
        if m in ("gpt-4", "gpt-4-0314", "gpt-4-0613", "gpt-4-32k"):
            return False
        return True  # gpt-4o*, gpt-4.1*, gpt-4-turbo, chatgpt*, o3/o4, o4-mini, …
    # Local Ollama: only models whose name marks them as vision-capable.
    markers = (
        "llava", "vision", "-vl", "vl-", ":vl", "moondream", "minicpm-v",
        "bakllava", "pixtral", "llama3.2-vision", "qwen2-vl", "qwen2.5-vl",
        "granite3.2-vision", "gemma3",
    )
    return any(tok in m for tok in markers)


def _build_llm(model: str, api_key: str | None):
    """
    Pick the right chat client for the requested model.

    - Grok models → browser-use ChatOpenAI pointed at the xAI endpoint. Grok
      handles structured output natively, so no JSON workaround is needed.
    - OpenAI models → browser-use ChatOpenAI against the native OpenAI endpoint.
    - Everything else → local Ollama via _SimpleJsonChatOllama (simple JSON
      mode + retries, required for small local models).
    """
    if is_grok_model(model):
        if not api_key or not api_key.strip():
            raise ValueError(
                "A Grok (xAI) API key is required to use Grok models. "
                "Add it in the API Keys panel (top right)."
            )
        return ChatOpenAI(
            model=model,
            api_key=api_key.strip(),
            base_url=settings.XAI_BASE_URL,
            temperature=0.2,
            # Grok reasoning models (grok-4.x) reject frequency_penalty / presence_penalty
            # / stop. browser-use defaults frequency_penalty to 0.3 and always sends it —
            # None suppresses it. We deliberately do NOT use the reasoning_models path,
            # since that forces reasoning_effort, which plain grok-4 rejects.
            frequency_penalty=None,
            timeout=float(settings.OLLAMA_TIMEOUT),
        )

    if is_openai_model(model):
        if not api_key or not api_key.strip():
            raise ValueError(
                "An OpenAI API key is required to use OpenAI models. "
                "Add it in the API Keys panel (top right)."
            )
        kwargs: dict = dict(
            model=model,
            api_key=api_key.strip(),
            base_url=settings.OPENAI_BASE_URL,
            # browser-use defaults frequency_penalty to 0.3; o-series reasoning
            # models reject it, so suppress it for everything (chat models don't need it).
            frequency_penalty=None,
            timeout=float(settings.OLLAMA_TIMEOUT),
        )
        # gpt-* accept a custom temperature; o1/o3/o4 only allow the default.
        if not _is_openai_reasoning(model):
            kwargs["temperature"] = 0.2
        return ChatOpenAI(**kwargs)

    return _SimpleJsonChatOllama(
        model=model,
        host=settings.OLLAMA_BASE_URL,
        timeout=float(settings.OLLAMA_TIMEOUT),
        ollama_options={
            # num_ctx MUST be set: Ollama's default (~4096) is smaller than
            # browser-use's prompt (system instructions + serialized page DOM), so
            # it silently truncates the START of the prompt — dropping the output
            # instructions. The model then emits invalid actions and the agent makes
            # zero progress. Sizing this to fit the prompt is the single biggest
            # factor in whether a local model can actually drive the browser.
            "num_ctx": settings.OLLAMA_NUM_CTX,
            # Cap output length so a verbose model can't run away generating tokens
            # for minutes on each step.
            "num_predict": settings.OLLAMA_NUM_PREDICT,
            # Low temperature is critical for reliable structured output — Ollama's
            # default (0.8) causes small models to emit truncated/invalid JSON.
            "temperature": 0.2,
        },
    )


# Latest browser screenshot per task — base64 PNG, populated during step callbacks
_latest_screenshots: dict[str, str] = {}


def get_latest_screenshot(task_id: str) -> str | None:
    return _latest_screenshots.get(task_id)


@dataclass
class _RunHandle:
    """References needed to stop a running agent mid-flight."""
    agent: Any = None       # browser-use Agent — agent.stop() sets a graceful flag
    loop: Any = None        # the agent worker thread's event loop
    run_task: Any = None    # the asyncio.Task wrapping agent.run()


# task_id → handle for every in-flight run, plus the set of tasks the user asked
# to stop (so the loop reports them as cancelled, not failed).
_active_runs: dict[str, _RunHandle] = {}
_stop_requested: set[str] = set()


def stop_agent(task_id: str) -> bool:
    """Halt a running agent immediately so it stops burning API tokens.

    Called from the FastAPI loop when the user presses Stop. We both set the
    browser-use stop flag (so it won't start another step) AND cancel the
    in-flight run task on the agent's own event loop (so the current LLM request
    is aborted right away instead of being allowed to finish).
    """
    _stop_requested.add(task_id)
    handle = _active_runs.get(task_id)
    if not handle:
        return False
    try:
        if handle.agent is not None:
            handle.agent.stop()
    except Exception:
        pass
    try:
        if handle.loop is not None and handle.run_task is not None:
            handle.loop.call_soon_threadsafe(handle.run_task.cancel)
    except Exception:
        pass
    return True


def _extract_result(history) -> str:
    """
    Extract the best possible result string from an AgentHistoryList.

    Fallback chain:
      1. Explicit done-action result  (agent called done() with text)
      2. Any extracted_content items  (agent called extract() during a step)
      3. Last memory field            (agent's running summary — most reliable fallback)
      4. Last evaluation_previous_goal (what the agent said after its last action)
      5. Any non-empty evaluation from any step, newest first
    """
    if not history:
        return "Task completed but no result was extracted."

    # 1 — explicit result
    result = history.final_result()
    if result and result.strip():
        return result.strip()

    # 2 — extracted content from any step
    extracted = [e for e in (history.extracted_content() or []) if e and e.strip()]
    if extracted:
        return "\n\n".join(extracted)

    # 3 & 4 — model thoughts (AgentBrain): memory is a running summary the agent
    # maintains across steps; evaluation_previous_goal describes the last action's outcome
    thoughts = history.model_thoughts() or []
    if thoughts:
        last = thoughts[-1]
        if last.memory and last.memory.strip():
            return last.memory.strip()
        if last.evaluation_previous_goal and last.evaluation_previous_goal.strip():
            return last.evaluation_previous_goal.strip()

    # 5 — scan backwards for any non-empty evaluation
    for thought in reversed(thoughts):
        val = (thought.evaluation_previous_goal or "").strip()
        if val:
            return val

    return "Task completed but no result was extracted."


class ReactLoop:
    def __init__(self, task_service: TaskService, ws_broadcast=None):
        self.task_service = task_service
        self.ws_broadcast = ws_broadcast

    async def run(self, task: Task, api_key: str | None = None, sensitive_data: dict | None = None) -> None:
        try:
            llm = _build_llm(task.model, api_key)
        except ValueError as exc:
            await self._fail(task.id, str(exc))
            return

        # Capture the FastAPI event loop so callbacks can schedule work back onto it
        main_loop = asyncio.get_running_loop()
        step_count = 0

        # ── Callback implementations (run in main FastAPI loop) ───────────────

        async def _on_step(state: Any, output: Any, step_num: int) -> None:
            nonlocal step_count
            step_count = step_num

            screenshot = getattr(state, 'screenshot', None)
            if screenshot:
                _latest_screenshots[task.id] = screenshot

            thought       = ""
            next_goal     = ""
            action_name   = "step"
            action_detail: dict = {}

            try:
                thought = (
                    getattr(output, "thinking", "") or
                    getattr(output, "evaluation_previous_goal", "") or
                    ""
                )
                next_goal = getattr(output, "next_goal", "") or ""

                if hasattr(output, "action") and output.action:
                    acts = output.action
                    if isinstance(acts, list) and acts:
                        a = acts[0]
                        action_name = type(a).__name__
                        if hasattr(a, "model_dump"):
                            raw = a.model_dump()
                            params = {k: v for k, v in raw.items() if v is not None}
                            # browser-use wraps the chosen action as
                            # {"<action>": {<params>}}; unwrap so we record the real
                            # action name (e.g. "go_to_url") and its parameters,
                            # instead of the generic "ActionModel" class name.
                            if len(params) == 1:
                                action_name = next(iter(params))
                                inner = params[action_name]
                                action_detail = inner if isinstance(inner, dict) else {"value": inner}
                            else:
                                action_detail = params
            except Exception:
                pass

            await self.task_service.increment_steps(task.id)
            await self._set_status(task.id, TaskStatus.RUNNING)

            # Persist the step detail (params + goal) as JSON so it can be shown
            # when the user expands the step, even after a page reload.
            try:
                detail_json = json.dumps(
                    {"input": action_detail, "next_goal": next_goal, "thought": thought},
                    ensure_ascii=False,
                )[:4000]
            except Exception:
                detail_json = None

            log = await self.task_service.add_log(
                task_id=task.id,
                actor="browser_use",
                step=step_num,
                action=action_name,
                observation=detail_json,
                reasoning=thought or next_goal or f"Step {step_num}",
            )
            await self.task_service.db.commit()

            await self._emit(task.id, "log", {
                "step":         step_num,
                "actor":        "browser_use",
                "thought":      thought,
                "next_goal":    next_goal,
                "action":       action_name,
                "action_input": action_detail,
                "log_id":       log.id,
            })
            await self._emit(task.id, "status_update", {"status": "running", "step": step_num})

        async def _on_done(history: Any) -> None:
            try:
                errors = history.errors() if callable(getattr(history, "errors", None)) else []
                if errors:
                    await self._emit(task.id, "step_errors", {
                        "errors": [str(e) for e in errors if e]
                    })
            except Exception:
                pass

        # ── Bridge: agent thread → main loop ──────────────────────────────────
        # browser-use calls these async callbacks from within the agent's thread loop.
        # We forward each call to the FastAPI loop and wait for it to complete so
        # that DB commits and WS broadcasts happen on the correct thread.

        async def on_step(state: Any, output: Any, step_num: int) -> None:
            fut = asyncio.run_coroutine_threadsafe(_on_step(state, output, step_num), main_loop)
            # Block agent thread until main loop finishes the callback (timeout: 60s)
            await asyncio.get_event_loop().run_in_executor(None, lambda: fut.result(60))

        async def on_done(history: Any) -> None:
            fut = asyncio.run_coroutine_threadsafe(_on_done(history), main_loop)
            await asyncio.get_event_loop().run_in_executor(None, lambda: fut.result(60))

        try:
            await self._set_status(task.id, TaskStatus.PLANNING)
            await self._emit(task.id, "status_update", {"status": "planning"})

            browser_profile = BrowserProfile(
                channel='chromium',
                # When set (desktop build), drive the bundled Chromium directly.
                # executable_path takes priority over channel-based discovery, so the
                # agent never depends on the user having Chrome installed. Empty in
                # dev → browser_use locates a local browser as before.
                executable_path=settings.BROWSER_EXECUTABLE_PATH or None,
                headless=settings.BROWSER_HEADLESS,
                # Taller (5:4) window so live screenshots fill the viewport panel
                # instead of letterboxing inside a wide 16:9 capture. 1280 wide keeps
                # desktop site layouts intact.
                window_size={'width': 1280, 'height': 1024},
                viewport={'width': 1280, 'height': 1024},
                args=[
                    '--no-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    # Localize the browser (Accept-Language + UI) so sites show the
                    # right currency/region instead of defaulting to GBP/USD.
                    f'--lang={settings.BROWSER_LOCALE}',
                ],
            )

            # The task message holds the goal plus the small, per-run DYNAMIC context
            # (user profile, current time/region, which sites have saved logins). The
            # large, unchanging behavioural rules live in the system prompt instead
            # (see extend_system_message) so the provider can cache that stable prefix
            # and the model isn't re-billed the same instructions on every step.
            agent_task = task.goal
            if task.context:
                agent_task = f"{task.goal}\n\nAdditional context and user preferences:\n{task.context}"
            agent_task += _profile_hint()
            agent_task += _now_and_locale_hint()
            agent_task += _credential_sites_hint(sensitive_data)

            # Custom tool: lets the agent pause and ask the user for an OTP / 2FA code.
            tools = Tools()

            @tools.action(
                "Ask the human user for a one-time password (OTP), SMS or email "
                "verification code, or 2FA code when a website requires one to "
                "continue. 'reason' is a short description of what the code is for "
                "(e.g. 'OTP to confirm payment on Amazon'). Returns the code the user "
                "entered, which you must then type into the verification field on the "
                "page. Never guess or fabricate codes — always obtain them this way."
            )
            async def request_otp_code(reason: str = "") -> ActionResult:
                code = await self._await_otp(task.id, reason, main_loop)
                if not code:
                    return ActionResult(
                        extracted_content="No OTP was provided (the user cancelled or it timed out).",
                        long_term_memory="OTP request was not fulfilled.",
                        include_in_memory=True,
                    )
                return ActionResult(
                    extracted_content=(
                        f"The user provided the verification code: {code}. "
                        "Type this exact code into the code/OTP field on the page now."
                    ),
                    long_term_memory=f"User-provided verification code is {code}.",
                    include_in_memory=True,
                )

            # Custom tool: pause and ask the user to securely provide sign-in
            # credentials for a site when none were saved. The user enters them in
            # the app (where they are also saved for next time) and they're handed
            # back here for the agent to type into the login form.
            @tools.action(
                "Ask the human user to securely provide login credentials (username "
                "and password) for a website when you must sign in but none are "
                "available. 'site' is the site's domain or name (e.g. 'amazon.in'); "
                "'reason' briefly says why sign-in is needed (e.g. 'to buy on the "
                "user's Amazon account'). Returns the username and password the user "
                "saved; type them into the site's login fields to sign in, then "
                "continue. Never invent credentials or create a new account — always "
                "obtain them this way."
            )
            async def request_credentials(site: str = "", reason: str = "") -> ActionResult:
                username, password = await self._await_credentials(
                    task.id, site, reason, main_loop
                )
                if not username:
                    return ActionResult(
                        extracted_content=(
                            "No credentials were provided (the user cancelled or it "
                            "timed out). You cannot sign in, so do not continue with "
                            "any step that requires being logged in."
                        ),
                        long_term_memory="Login credentials were not provided.",
                        include_in_memory=True,
                    )
                return ActionResult(
                    extracted_content=(
                        f"The user provided sign-in credentials for {site or 'the site'}. "
                        f"Username: {username}\nPassword: {password}\n"
                        "Type these into the site's login form and sign in now, then "
                        "continue the task."
                    ),
                    long_term_memory=(
                        f"User provided login credentials for {site or 'the site'} "
                        f"(username: {username}). Use them to sign in."
                    ),
                    include_in_memory=True,
                )

            # Custom tool: ask the user a free-form question (with optional choices)
            # and wait for their answer — used to confirm relaxing a constraint (e.g.
            # raising the price budget) instead of abandoning the task.
            @tools.action(
                "Ask the human user a question and wait for their answer when you need "
                "a decision to continue — most importantly, before giving up because "
                "nothing matches the user's constraints (e.g. no product within the "
                "price range). 'question' is what to ask; 'options' is an optional list "
                "of short choices to offer (e.g. ['Up to 750', 'Up to 1000', 'No price "
                "limit', 'Cancel purchase']). Returns the user's answer; act on it. Use "
                "this instead of stopping with a partial result."
            )
            async def ask_user(question: str, options: list[str] | None = None) -> ActionResult:
                answer = await self._await_user_answer(
                    task.id, question, options or [], main_loop
                )
                if not answer:
                    return ActionResult(
                        extracted_content=(
                            "The user did not answer (cancelled or timed out). Do not keep "
                            "waiting; wrap up with what you have."
                        ),
                        long_term_memory="User did not answer the question.",
                        include_in_memory=True,
                    )
                return ActionResult(
                    extracted_content=(
                        f"The user answered: {answer}. Continue the task according to "
                        "this answer."
                    ),
                    long_term_memory=f"User answered '{answer}' to: {question}",
                    include_in_memory=True,
                )

            # Custom tool: read a simple text/image CAPTCHA with a local vision model,
            # falling back to asking the user (via the same OTP banner) if it can't.
            @tools.action(
                "Read and solve a simple text/image CAPTCHA on the current page — a "
                "small picture of distorted letters/numbers the user must retype. Call "
                "this when such a CAPTCHA is blocking progress. Returns the CAPTCHA "
                "characters; type that exact text into the CAPTCHA field, then continue. "
                "'challenge_hint' optionally notes where the CAPTCHA is. Do NOT use for "
                "reCAPTCHA/hCaptcha checkboxes or image-grid challenges."
            )
            async def solve_captcha(browser_session, challenge_hint: str = "") -> ActionResult:
                import base64

                # 1. Capture the current page (PNG = lossless, easier for OCR).
                image_b64 = ""
                try:
                    shot = await browser_session.take_screenshot(format="png")
                    if shot:
                        image_b64 = shot if isinstance(shot, str) else base64.b64encode(shot).decode()
                except Exception as exc:
                    logger.warning("captcha_screenshot_error", error=str(exc))

                # 2. Try to read it with a local vision model.
                solution = ""
                if image_b64:
                    solution = await _read_captcha_from_screenshot(image_b64, task.model)

                if solution:
                    return ActionResult(
                        extracted_content=(
                            f"The CAPTCHA reads: {solution}. Type this exact text into "
                            "the CAPTCHA input field on the page now, then continue."
                        ),
                        long_term_memory=f"Solved CAPTCHA: {solution}",
                        include_in_memory=True,
                    )

                # 3. Couldn't read it automatically — ask the user via the OTP banner.
                reason = (
                    challenge_hint
                    or "Couldn't read the CAPTCHA automatically. Please type the "
                       "characters shown in the CAPTCHA image in the live browser."
                )
                code = await self._await_otp(task.id, reason, main_loop)
                if code:
                    return ActionResult(
                        extracted_content=(
                            f"The user read the CAPTCHA as: {code}. Type this exact text "
                            "into the CAPTCHA input field on the page now, then continue."
                        ),
                        long_term_memory=f"User-provided CAPTCHA solution: {code}",
                        include_in_memory=True,
                    )
                return ActionResult(
                    extracted_content=(
                        "The CAPTCHA could not be solved automatically and no solution "
                        "was provided. Try reloading the CAPTCHA for a clearer image, or "
                        "look for an alternative way to proceed."
                    ),
                    long_term_memory="CAPTCHA could not be solved.",
                    include_in_memory=True,
                )

            # Feed page screenshots to multimodal models so the agent can actually
            # SEE the page (read image/canvas text, sparse-DOM pages) instead of
            # working blind off the DOM. Off for text-only local models.
            vision_on = _model_supports_vision(task.model)
            logger.info("agent_vision", model=task.model, vision=vision_on)

            agent = Agent(
                task=agent_task,
                llm=llm,
                browser_profile=browser_profile,
                tools=tools,
                max_failures=5,
                use_vision=vision_on,
                enable_signal_handler=False,
                register_new_step_callback=on_step,
                register_done_callback=on_done,
                # All the large, unchanging behavioural rules go here in the system
                # prompt (not the per-task message). This (a) keeps the task = the
                # user's goal so browser-use's URL auto-extraction can't latch onto a
                # stray domain, and (b) makes a big STABLE prefix that providers cache
                # automatically (OpenAI/Grok cached-input pricing) and Ollama keeps
                # warm in its KV cache — so the same instructions aren't reprocessed
                # and re-billed on every step of a run. Anything per-run/dynamic
                # (goal, profile, current time/region, saved-site hint) stays in the
                # task message above so it never busts this cached prefix.
                extend_system_message=(
                    _SOURCE_INSTRUCTIONS + _OUTPUT_FORMAT_INSTRUCTIONS + _CURRENCY_INSTRUCTIONS
                    + _LOGIN_INSTRUCTIONS + _PURCHASE_INSTRUCTIONS
                    + _OTP_INSTRUCTIONS + _CAPTCHA_INSTRUCTIONS + _FORM_INSTRUCTIONS
                ).strip(),
                # CRITICAL: when True (the default) browser-use scans the task for a
                # URL/domain and hard-navigates there as the first action, skipping
                # the model entirely — that's why it always jumped straight to Amazon
                # (e.g. from an example goal or a stored credential). Off = the agent
                # must reason and choose where to go, honouring the steering above.
                directly_open_url=False,
                # Run-only secrets (credentials / service API keys). The model sees
                # only placeholder key names; browser-use substitutes the real values
                # when typing and redacts them from history. They are never stored on
                # the task or sent in the prompt.
                #
                # SECURITY NOTE: browser-use warns that sensitive_data without
                # BrowserProfile(allowed_domains=[...]) can be exfiltrated via a
                # prompt-injection attack on a malicious page. We pass credentials
                # domain-scoped ({ "https://site": {...} }), so each secret is only
                # offered on its matching domain — the recommended mitigation. To fully
                # lock this down, set allowed_domains to the credential domains when
                # secrets are present (trade-off: restricts general browsing).
                sensitive_data=sensitive_data or None,
                # browser-use auto-detects 75s/180s for local models, which is too
                # tight for small Ollama models on modest hardware. Raise both so a
                # slow generation isn't killed mid-response.
                llm_timeout=settings.LLM_TIMEOUT,
                step_timeout=settings.AGENT_STEP_TIMEOUT,
            )

            # Register so the API's Stop button can halt this run immediately.
            _active_runs[task.id] = _RunHandle(agent=agent)

            await self._set_status(task.id, TaskStatus.RUNNING)
            await self._emit(task.id, "status_update", {"status": "running"})

            # Run the agent in a dedicated thread so it gets its own asyncio.run()
            # call (= guaranteed ProactorEventLoop on Windows, which supports subprocesses).
            # A side capture loop screenshots the browser ~1×/s so the UI viewport
            # shows a live feed between agent steps, not just per-step snapshots.
            def _run_agent_thread() -> Any:
                async def _runner():
                    run = asyncio.ensure_future(agent.run(max_steps=task.max_steps))

                    # Expose this loop + task so stop_agent() can cancel the
                    # in-flight LLM call from the FastAPI thread.
                    handle = _active_runs.get(task.id)
                    if handle is not None:
                        handle.loop = asyncio.get_running_loop()
                        handle.run_task = run

                    async def _capture_loop():
                        import base64
                        while not run.done():
                            try:
                                session = getattr(agent, "browser_session", None)
                                if session is not None:
                                    shot = await session.take_screenshot(format="jpeg", quality=55)
                                    if shot:
                                        _latest_screenshots[task.id] = base64.b64encode(shot).decode()
                            except Exception:
                                pass
                            await asyncio.sleep(0.9)

                    capture = asyncio.ensure_future(_capture_loop())
                    try:
                        return await run
                    finally:
                        capture.cancel()
                        try:
                            await capture
                        except (asyncio.CancelledError, Exception):
                            pass

                return asyncio.run(_runner())

            with concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="bu-agent") as pool:
                history = await main_loop.run_in_executor(pool, _run_agent_thread)

            # User pressed Stop — the agent was halted on purpose. agent_service
            # marks the task cancelled; don't report it as completed or failed here.
            if task.id in _stop_requested:
                logger.info("agent_stopped_by_user", task_id=task.id)
                return

            if step_count == 0:
                # Agent exited without completing a single step — this always means
                # the LLM could not produce a valid response (parse errors, connection
                # failure, etc.).  Surface it as a failure so the UI doesn't show a
                # false "Completed" status.
                errors = []
                try:
                    errors = [str(e) for e in (history.errors() or []) if e] if history else []
                except Exception:
                    pass
                reason = (
                    errors[0] if errors
                    else "The model failed to generate a valid response. "
                         "Check that Ollama is running and the model supports JSON output."
                )
                await self._fail(task.id, reason)
                return

            result = _extract_result(history)

            await self._complete(task.id, result, step_count)

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # If the user stopped the run, the cancellation surfaces here as an
            # exception — treat it as a cancellation, not a real failure.
            if task.id in _stop_requested:
                logger.info("agent_stopped_by_user", task_id=task.id)
                raise asyncio.CancelledError() from exc
            tb = traceback.format_exc()
            short = str(exc) or type(exc).__name__
            logger.exception("browser_use_error", task_id=task.id, error=short)
            await self._emit(task.id, "error_detail", {
                "error":     short,
                "traceback": tb,
                "step":      step_count,
            })
            await self._fail(task.id, short)
            raise
        finally:
            _active_runs.pop(task.id, None)
            _stop_requested.discard(task.id)

    # ── Helpers ───────────────────────────────────────────────────────

    async def _set_status(self, task_id: str, status: TaskStatus) -> None:
        await self.task_service.update_status(task_id, status)
        await self.task_service.db.commit()

    async def _complete(self, task_id: str, result: str, steps: int) -> None:
        await self.task_service.set_result(task_id, result)
        await self._set_status(task_id, TaskStatus.COMPLETED)
        await self._emit(task_id, "completed", {"result": result, "steps": steps})
        await self._emit(task_id, "status_update", {"status": "completed"})
        logger.info("browser_use_completed", task_id=task_id, steps=steps)

    async def _fail(self, task_id: str, reason: str) -> None:
        try:
            await self.task_service.set_error(task_id, reason)
            await self._set_status(task_id, TaskStatus.FAILED)
        except Exception:
            pass
        await self._emit(task_id, "failed", {"reason": reason})
        await self._emit(task_id, "status_update", {"status": "failed"})

    async def _await_otp(self, task_id: str, reason: str, main_loop, timeout: float = settings.HUMAN_INPUT_TIMEOUT) -> str | None:
        """Pause the agent until the user supplies an OTP code (called from the worker thread).

        Status changes and WS emits are bridged onto the FastAPI main loop; the wait
        itself blocks a threadpool thread on otp_gate's Event, so the agent's own event
        loop (and the live-screenshot capture loop) keep running while we wait.
        """
        req = otp_gate.open_request(task_id, reason)

        async def _announce() -> None:
            await self._set_status(task_id, TaskStatus.WAITING_OTP)
            await self._emit(task_id, "otp_required", {"reason": req.reason})
            await self._emit(task_id, "status_update", {"status": "waiting_otp"})

        fut = asyncio.run_coroutine_threadsafe(_announce(), main_loop)
        await asyncio.get_event_loop().run_in_executor(None, lambda: fut.result(30))

        got = await asyncio.get_event_loop().run_in_executor(None, lambda: req.event.wait(timeout))
        code = req.value if (got and not req.cancelled) else None
        otp_gate.clear(task_id)

        async def _resume() -> None:
            await self._set_status(task_id, TaskStatus.RUNNING)
            await self._emit(task_id, "otp_submitted", {"provided": code is not None})
            await self._emit(task_id, "status_update", {"status": "running"})

        fut2 = asyncio.run_coroutine_threadsafe(_resume(), main_loop)
        await asyncio.get_event_loop().run_in_executor(None, lambda: fut2.result(30))
        return code

    async def _await_credentials(
        self, task_id: str, site: str, reason: str, main_loop, timeout: float = settings.HUMAN_INPUT_TIMEOUT
    ) -> tuple[str | None, str | None]:
        """Pause the agent until the user supplies login credentials.

        Same cross-thread bridge as _await_otp: the wait blocks a threadpool thread
        on cred_gate's Event so the agent's own loop (and the live screenshot capture)
        keep running. Returns (username, password) or (None, None) if cancelled.
        """
        req = cred_gate.open_request(task_id, site, reason)

        async def _announce() -> None:
            await self._set_status(task_id, TaskStatus.WAITING_CREDENTIALS)
            await self._emit(task_id, "credentials_required", {
                "site": req.site, "reason": req.reason,
            })
            await self._emit(task_id, "status_update", {"status": "waiting_credentials"})

        fut = asyncio.run_coroutine_threadsafe(_announce(), main_loop)
        await asyncio.get_event_loop().run_in_executor(None, lambda: fut.result(30))

        got = await asyncio.get_event_loop().run_in_executor(None, lambda: req.event.wait(timeout))
        if got and not req.cancelled:
            username, password = req.username, req.password
        else:
            username, password = None, None
        cred_gate.clear(task_id)

        async def _resume() -> None:
            await self._set_status(task_id, TaskStatus.RUNNING)
            await self._emit(task_id, "credentials_submitted", {"provided": username is not None})
            await self._emit(task_id, "status_update", {"status": "running"})

        fut2 = asyncio.run_coroutine_threadsafe(_resume(), main_loop)
        await asyncio.get_event_loop().run_in_executor(None, lambda: fut2.result(30))
        return username, password

    async def _await_user_answer(
        self, task_id: str, question: str, options: list[str], main_loop, timeout: float = settings.HUMAN_INPUT_TIMEOUT
    ) -> str | None:
        """Pause the agent until the user answers a free-form question.

        Same cross-thread bridge as _await_otp. Returns the answer string, or None
        if the user cancelled / it timed out.
        """
        req = ask_gate.open_request(task_id, question, options)

        async def _announce() -> None:
            await self._set_status(task_id, TaskStatus.WAITING_INPUT)
            await self._emit(task_id, "input_required", {
                "question": req.question, "options": req.options,
            })
            await self._emit(task_id, "status_update", {"status": "waiting_input"})

        fut = asyncio.run_coroutine_threadsafe(_announce(), main_loop)
        await asyncio.get_event_loop().run_in_executor(None, lambda: fut.result(30))

        got = await asyncio.get_event_loop().run_in_executor(None, lambda: req.event.wait(timeout))
        answer = req.answer if (got and not req.cancelled) else None
        ask_gate.clear(task_id)

        async def _resume() -> None:
            await self._set_status(task_id, TaskStatus.RUNNING)
            await self._emit(task_id, "input_submitted", {"provided": answer is not None})
            await self._emit(task_id, "status_update", {"status": "running"})

        fut2 = asyncio.run_coroutine_threadsafe(_resume(), main_loop)
        await asyncio.get_event_loop().run_in_executor(None, lambda: fut2.result(30))
        return answer

    async def _emit(self, task_id: str, event_type: str, data: dict) -> None:
        if self.ws_broadcast:
            try:
                await self.ws_broadcast(task_id, {
                    "type":    event_type,
                    "task_id": task_id,
                    "data":    data,
                    "ts":      datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass
