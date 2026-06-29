"""
Credential vault endpoints.

Site logins are stored encrypted at rest (see app.services.vault_service) and never
leave the local machine. Passwords are write-only: the list/read endpoints never
return them, and a blank password on upsert keeps the existing one.
"""

import csv
import io

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel, Field

from app.services import vault_service

router = APIRouter(prefix="/vault", tags=["vault"])


class VaultEntry(BaseModel):
    id: str
    site: str
    username: str
    has_password: bool


class VaultListResponse(BaseModel):
    entries: list[VaultEntry]
    backend: str  # "dpapi" (Windows, OS-user-bound) or "fernet" (fallback)


class VaultUpsertRequest(BaseModel):
    site: str = Field(..., min_length=1, max_length=512)
    username: str = Field("", max_length=512)
    # Blank = keep the existing password (write-only field).
    password: str = Field("", max_length=1024)


@router.get("", response_model=VaultListResponse, summary="List saved logins (no passwords)")
async def list_vault() -> VaultListResponse:
    from app.core import crypto
    return VaultListResponse(entries=vault_service.list_entries(), backend=crypto.backend())


@router.post("", response_model=VaultEntry, summary="Add or update a saved login")
async def upsert_vault(body: VaultUpsertRequest) -> VaultEntry:
    entry = vault_service.upsert(body.site, body.username, body.password)
    return VaultEntry(**entry)


@router.delete("/{entry_id}", status_code=204, summary="Delete a saved login")
async def delete_vault(entry_id: str) -> None:
    vault_service.delete(entry_id)


def _parse_password_csv(text: str) -> list[dict]:
    """Map a browser password CSV export to [{site, username, password}].

    Handles the common header variants (Chrome/Edge: name,url,username,password;
    Firefox: url,username,password,…; plus a few manager exports) case-insensitively.
    """
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    norm = {(h or "").strip().lower(): h for h in reader.fieldnames}

    def pick(*cands: str) -> str | None:
        for c in cands:
            if c in norm:
                return norm[c]
        return None

    url_key = pick("url", "login_uri", "website", "web site", "site", "hostname", "name")
    user_key = pick("username", "login", "login_username", "user", "email", "login name", "account")
    pass_key = pick("password", "login_password", "pass")

    rows: list[dict] = []
    for r in reader:
        site = (r.get(url_key) or "").strip() if url_key else ""
        username = (r.get(user_key) or "").strip() if user_key else ""
        password = (r.get(pass_key) or "") if pass_key else ""
        if not site and not username and not password:
            continue
        rows.append({"site": site, "username": username, "password": password})
    return rows


class CsvImportResult(BaseModel):
    imported: int
    skipped: int


@router.post("/import-csv", response_model=CsvImportResult,
             summary="Bulk-import site logins from a browser password CSV export")
async def import_csv(file: UploadFile = File(...)) -> CsvImportResult:
    raw = await file.read()
    # utf-8-sig strips the BOM some browsers prepend; replace keeps odd bytes from crashing.
    text = raw.decode("utf-8-sig", errors="replace")
    rows = _parse_password_csv(text)
    result = vault_service.bulk_import_credentials(rows)
    return CsvImportResult(**result)


# ── API keys (provider + service) ──────────────────────────────────────────
class ApiKeyEntry(BaseModel):
    id: str
    name: str
    has_value: bool


class ApiKeyListResponse(BaseModel):
    keys: list[ApiKeyEntry]


class ApiKeyUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    # Blank = keep the existing value (write-only field).
    value: str = Field("", max_length=4096)


@router.get("/api-keys", response_model=ApiKeyListResponse, summary="List saved API keys (no values)")
async def list_api_keys() -> ApiKeyListResponse:
    return ApiKeyListResponse(keys=vault_service.list_api_keys())


@router.post("/api-keys", response_model=ApiKeyEntry, summary="Add or update an API key")
async def upsert_api_key(body: ApiKeyUpsertRequest) -> ApiKeyEntry:
    entry = vault_service.upsert_api_key(body.name, body.value)
    return ApiKeyEntry(**entry)


@router.delete("/api-keys/{entry_id}", status_code=204, summary="Delete an API key")
async def delete_api_key(entry_id: str) -> None:
    vault_service.delete_api_key(entry_id)
