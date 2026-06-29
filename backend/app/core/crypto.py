"""
At-rest encryption for the local credential vault.

Primary path (Windows): DPAPI via crypt32 (CryptProtectData / CryptUnprotectData).
The ciphertext is bound to the current Windows user account — only that user, on
that machine, can decrypt it. This is the same mechanism Chrome/Edge use to protect
saved passwords, so it works seamlessly for an autonomous agent (no master password
to type each session) while keeping secrets unreadable to other OS users and to
casual file access.

Fallback (non-Windows / DPAPI unavailable): Fernet (AES-128-CBC + HMAC) with a key
file stored alongside the vault. Less protective than DPAPI — the key sits next to
the data — but keeps the app working off-Windows for development.

Either way the plaintext credentials never touch disk and never leave the local
machine: the vault is decrypted only in memory, and the model sees only placeholder
variable names (browser-use sensitive_data), never the real values.
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.core.logging import get_logger

logger = get_logger(__name__)

_IS_WINDOWS = sys.platform == "win32"

# App-specific entropy mixed into DPAPI so the blob can only be decrypted by this
# app's code path, not any other DPAPI consumer running as the same user.
# NOTE: this value is a cryptographic constant, NOT a display name — it must match
# the entropy used when the existing vault.enc was written. Changing it would make
# already-saved credentials permanently undecryptable, so it is intentionally kept
# as the original literal even though the app is now named Vellam.
_ENTROPY = b"FlowWiseAI-vault-v1"


# ── Windows DPAPI via ctypes (no extra dependency) ─────────────────────────
if _IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    class _DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def _to_blob(data: bytes) -> _DATA_BLOB:
        buf = ctypes.create_string_buffer(data, len(data))
        return _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))

    def _from_blob(blob: _DATA_BLOB) -> bytes:
        return ctypes.string_at(blob.pbData, blob.cbData)

    def _dpapi_encrypt(data: bytes) -> bytes:
        blob_in = _to_blob(data)
        entropy = _to_blob(_ENTROPY)
        blob_out = _DATA_BLOB()
        ok = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in), "Vellam vault",
            ctypes.byref(entropy), None, None, 0, ctypes.byref(blob_out),
        )
        if not ok:
            raise OSError("CryptProtectData failed")
        try:
            return _from_blob(blob_out)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)

    def _dpapi_decrypt(data: bytes) -> bytes:
        blob_in = _to_blob(data)
        entropy = _to_blob(_ENTROPY)
        blob_out = _DATA_BLOB()
        ok = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in), None,
            ctypes.byref(entropy), None, None, 0, ctypes.byref(blob_out),
        )
        if not ok:
            raise OSError("CryptUnprotectData failed")
        try:
            return _from_blob(blob_out)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)


# ── Fernet fallback (non-Windows) ──────────────────────────────────────────
def _fernet(key_path: Path):
    from cryptography.fernet import Fernet

    if key_path.exists():
        key = key_path.read_bytes()
    else:
        key = Fernet.generate_key()
        key_path.write_bytes(key)
        try:
            key_path.chmod(0o600)
        except OSError:
            pass
    return Fernet(key)


def encrypt(data: bytes, key_path: Path) -> bytes:
    """Encrypt bytes for storage. key_path is only used by the Fernet fallback."""
    if _IS_WINDOWS:
        return _dpapi_encrypt(data)
    return _fernet(key_path).encrypt(data)


def decrypt(data: bytes, key_path: Path) -> bytes:
    """Decrypt bytes read from storage."""
    if _IS_WINDOWS:
        return _dpapi_decrypt(data)
    return _fernet(key_path).decrypt(data)


def backend() -> str:
    return "dpapi" if _IS_WINDOWS else "fernet"
