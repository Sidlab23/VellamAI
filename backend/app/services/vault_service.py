"""
Local secrets vault — site logins AND service/provider API keys, encrypted at rest.

The whole vault is a single JSON document encrypted with app.core.crypto (Windows
DPAPI, bound to the OS user). Plaintext exists only in memory while a request is
handled. Secret values are write-only from the API's perspective: list/read endpoints
never return passwords or key values.

On disk the document is:
    { "credentials": [ {id, site, username, password} ],
      "api_keys":    [ {id, name, value} ] }
(A bare list is the legacy credentials-only format and is migrated on load.)

When an agent runs, build_sensitive_data() turns logins + non-LLM service keys into
browser-use sensitive_data, and get_api_key() resolves the provider key for the run —
so the model only ever sees placeholder variable names, never the real secret, and
the browser never receives key values at all.
"""

from __future__ import annotations

import json
import re
import threading
import uuid
from pathlib import Path
from urllib.parse import urlparse

from app.config import settings
from app.core import crypto
from app.core.logging import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()

# Featured LLM-provider keys. These are used by the backend itself (inference,
# model listing, clarify) and must NOT be injected into page typing.
GROK_KEY_NAME = "Grok (xAI)"
OPENAI_KEY_NAME = "OpenAI"
_PROVIDER_NAMES = {GROK_KEY_NAME.lower(), OPENAI_KEY_NAME.lower()}


def _vault_path() -> Path:
    return Path(settings.VAULT_FILE)


def _key_path() -> Path:
    # Only used by the non-Windows Fernet fallback.
    return Path(settings.VAULT_FILE + ".key")


def _empty() -> dict:
    return {"credentials": [], "api_keys": [], "profile": {}}


def _load() -> dict:
    """Return the vault as {"credentials": [...], "api_keys": [...], "profile": {...}}."""
    path = _vault_path()
    if not path.exists():
        return _empty()
    try:
        raw = crypto.decrypt(path.read_bytes(), _key_path())
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        # A corrupt/undecryptable vault (e.g. copied from another machine/user)
        # must not crash the app — surface empty and let the user re-enter.
        logger.warning("vault_load_failed", error=str(exc))
        return _empty()
    # Legacy format: a bare list of credential entries.
    if isinstance(data, list):
        return {"credentials": data, "api_keys": [], "profile": {}}
    if not isinstance(data, dict):
        return _empty()
    data.setdefault("credentials", [])
    data.setdefault("api_keys", [])
    data.setdefault("profile", {})
    return data


def _save(data: dict) -> None:
    blob = crypto.encrypt(json.dumps(data).encode("utf-8"), _key_path())
    _vault_path().write_bytes(blob)


# ── Credentials (site logins) ──────────────────────────────────────────────
def _public_cred(e: dict) -> dict:
    """A credential safe to return over the API — never includes the password."""
    return {
        "id": e.get("id"),
        "site": e.get("site", ""),
        "username": e.get("username", ""),
        "has_password": bool(e.get("password")),
    }


def list_entries() -> list[dict]:
    with _lock:
        return [_public_cred(e) for e in _load()["credentials"]]


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def upsert(site: str, username: str, password: str | None) -> dict:
    """Add or update a login, matched by site (case-insensitive).

    A blank password keeps the existing one (write-only field).
    """
    site = (site or "").strip()
    username = (username or "").strip()
    with _lock:
        data = _load()
        creds = data["credentials"]
        idx = next((i for i, e in enumerate(creds) if _norm(e.get("site")) == _norm(site)), -1)
        if idx >= 0:
            creds[idx]["site"] = site
            creds[idx]["username"] = username
            if password:
                creds[idx]["password"] = password
            saved = creds[idx]
        else:
            saved = {"id": uuid.uuid4().hex, "site": site, "username": username, "password": password or ""}
            creds.append(saved)
        _save(data)
        return _public_cred(saved)


def delete(entry_id: str) -> bool:
    with _lock:
        data = _load()
        creds = data["credentials"]
        remaining = [e for e in creds if e.get("id") != entry_id]
        if len(remaining) == len(creds):
            return False
        data["credentials"] = remaining
        _save(data)
        return True


def bulk_import_credentials(entries: list[dict]) -> dict:
    """Add/replace many site logins in one pass (used by CSV import).

    Matched by site (case-insensitive); a later row for the same site wins, so
    re-importing simply refreshes. One decrypt + one encrypt for the whole batch.
    `entries` are dicts with site / username / password. Returns {imported, skipped}.
    """
    imported = 0
    skipped = 0
    with _lock:
        data = _load()
        creds = data["credentials"]
        idx_by_site = {_norm(e.get("site")): i for i, e in enumerate(creds)}
        for raw in entries:
            site = (raw.get("site") or "").strip()
            username = (raw.get("username") or "").strip()
            password = raw.get("password") or ""
            # Need at least a site and something to log in with.
            if not site or not (username or password):
                skipped += 1
                continue
            key = _norm(site)
            if key in idx_by_site:
                e = creds[idx_by_site[key]]
                e["site"] = site
                e["username"] = username
                if password:
                    e["password"] = password
            else:
                creds.append({
                    "id": uuid.uuid4().hex, "site": site,
                    "username": username, "password": password,
                })
                idx_by_site[key] = len(creds) - 1
            imported += 1
        _save(data)
    return {"imported": imported, "skipped": skipped}


# ── User profile (local "memory" the agent uses on every task) ──────────────
def get_profile() -> dict:
    """The user's saved profile (name, city, sizes, preferences…). Non-secret-ish
    but kept in the encrypted vault since it can include an address/contact."""
    with _lock:
        p = _load().get("profile")
        return dict(p) if isinstance(p, dict) else {}


def set_profile(profile: dict) -> dict:
    """Replace the saved profile. Only string keys with string values are stored."""
    clean = {
        str(k): v for k, v in (profile or {}).items()
        if isinstance(k, str) and isinstance(v, str)
    }
    with _lock:
        data = _load()
        data["profile"] = clean
        _save(data)
        return dict(clean)


# ── API keys (provider + service) ──────────────────────────────────────────
def _public_key(e: dict) -> dict:
    """An API key safe to return over the API — never includes the value."""
    return {"id": e.get("id"), "name": e.get("name", ""), "has_value": bool(e.get("value"))}


def list_api_keys() -> list[dict]:
    with _lock:
        return [_public_key(e) for e in _load()["api_keys"]]


def upsert_api_key(name: str, value: str | None) -> dict:
    """Add or update an API key, matched by name (case-insensitive).

    A blank value keeps the existing one (write-only field).
    """
    name = (name or "").strip()
    with _lock:
        data = _load()
        keys = data["api_keys"]
        idx = next((i for i, e in enumerate(keys) if _norm(e.get("name")) == _norm(name)), -1)
        if idx >= 0:
            keys[idx]["name"] = name
            if value:
                keys[idx]["value"] = value
            saved = keys[idx]
        else:
            saved = {"id": uuid.uuid4().hex, "name": name, "value": value or ""}
            keys.append(saved)
        _save(data)
        return _public_key(saved)


def delete_api_key(entry_id: str) -> bool:
    with _lock:
        data = _load()
        keys = data["api_keys"]
        remaining = [e for e in keys if e.get("id") != entry_id]
        if len(remaining) == len(keys):
            return False
        data["api_keys"] = remaining
        _save(data)
        return True


def get_api_key(name: str) -> str:
    """Resolve a stored key value by name (backend-internal; never exposed via API)."""
    with _lock:
        for e in _load()["api_keys"]:
            if _norm(e.get("name")) == _norm(name):
                return e.get("value") or ""
    return ""


def provider_key_for_model(model: str) -> str:
    """The provider key a model needs (Grok / OpenAI), or '' for local models."""
    m = (model or "").lower().strip()
    if m.startswith("grok"):
        return get_api_key(GROK_KEY_NAME)
    if m.startswith(("gpt", "chatgpt", "o1", "o3", "o4")):
        return get_api_key(OPENAI_KEY_NAME)
    return ""


# ── browser-use sensitive_data (variable replacement) ──────────────────────
def _host_of(url: str) -> str:
    v = (url or "").strip()
    if not v:
        return ""
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    try:
        host = (urlparse(v).hostname or "").lower()
    except Exception:
        return ""
    return host[4:] if host.startswith("www.") else host


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")
    return s or "x"


def build_sensitive_data() -> dict:
    """Domain-scoped logins + flat service-key placeholders for browser-use.

    Logins → { "https://*.<host>": { "<slug>_username": …, "<slug>_password": … } }
      (wildcard host so the secret works on the apex and its subdomains).
    Service API keys → { "<slug>_api_key": … }  (LLM-provider keys excluded — those
      are used by the backend, not typed into pages).
    The model only ever sees these placeholder key names.
    """
    data: dict = {}
    with _lock:
        d = _load()
        creds = list(d["credentials"])
        keys = list(d["api_keys"])

    for e in creds:
        host = _host_of(e.get("site", ""))
        user = (e.get("username") or "").strip()
        if not host or not user:
            continue
        domain = f"https://*.{host}"
        s = _slug(host)
        bucket = data.setdefault(domain, {})
        bucket[f"{s}_username"] = user
        pw = e.get("password") or ""
        if pw:
            bucket[f"{s}_password"] = pw

    for e in keys:
        name = (e.get("name") or "").strip()
        value = e.get("value") or ""
        if not name or not value or _norm(name) in _PROVIDER_NAMES:
            continue
        data[f"{_slug(name)}_api_key"] = value

    return data
