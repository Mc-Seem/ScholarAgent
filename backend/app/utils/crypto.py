"""Encryption utility for API key storage at rest.

Uses Fernet symmetric encryption (AES-128-CBC + HMAC-SHA256).
The key is stored in a machine-local file with 0600 permissions.
"""

import os
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken

# Store the encryption key outside the project directory so it survives repo changes
_KEY_DIR = Path.home() / ".scholaragent"
_KEY_FILE = _KEY_DIR / "secret.key"


def _get_or_create_key() -> bytes:
    """Load or generate the Fernet encryption key."""
    if _KEY_FILE.exists():
        return _KEY_FILE.read_bytes()

    _KEY_DIR.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    _KEY_FILE.chmod(0o600)
    return key


_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_get_or_create_key())
    return _fernet


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string, return base64-encoded ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext string."""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("Failed to decrypt API key — the encryption key may have changed.")


def mask_key(key: str) -> str:
    """Mask an API key for display: show first 4 and last 4 chars."""
    if not key or len(key) <= 12:
        return "****" if key else ""
    return f"{key[:4]}...{key[-4:]}"