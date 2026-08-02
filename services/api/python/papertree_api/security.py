"""Password hashing and session tokens. Stdlib only; see `0004_auth.sql` for why.

Everything here is deliberately boring. The interesting decision — a session row rather than a
signed JWT — is argued in the migration, not repeated here.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

from .settings import SCRYPT_N, SCRYPT_P, SCRYPT_R

#: 32 bytes of CSPRNG, urlsafe-b64 without padding: 43 characters, 256 bits.
_TOKEN_BYTES = 32
_SALT_BYTES = 16


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def now_iso() -> str:
    """UTC, seconds precision, `Z`-suffixed — the convention 0001_core.sql's timestamps use."""
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def hash_password(password: str) -> str:
    """`scrypt$n$r$p$<salt>$<hash>`, with the cost parameters IN the string.

    Storing them per row is what makes raising the cost a rolling change rather than a mass
    invalidation: `verify_password` reads n/r/p off the row it is checking.
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=64
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time compare against a stored `hash_password` output.

    Returns False rather than raising on a malformed row: a corrupt credential is a failed login,
    not a 500 that tells the caller their row is malformed.
    """
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_unb64(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(_unb64(expected)),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, _unb64(expected))


def mint_token() -> tuple[str, str]:
    """`(token, token_hash)`. The token goes to the client; only the hash is ever stored.

    A plain SHA-256 with no salt and no work factor, and that is correct here rather than lazy:
    the input is 256 bits of CSPRNG output, so there is no dictionary to run and a slow KDF would
    only add latency to every authenticated request. The reason to hash at all is that a read of
    the `sessions` table must not yield a usable credential.
    """
    token = _b64(secrets.token_bytes(_TOKEN_BYTES))
    return token, hashlib.sha256(token.encode("ascii")).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def create_session(conn: sqlite3.Connection, user_id: str, *, hours: int) -> str:
    """Inserts a session row and returns the bearer token. Autocommit; nothing to commit."""
    token, digest = mint_token()
    expires = (datetime.now(UTC) + timedelta(hours=hours)).replace(microsecond=0)
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (digest, user_id, now_iso(), expires.isoformat().replace("+00:00", "Z")),
    )
    return token


def user_for_token(conn: sqlite3.Connection, token: str) -> str | None:
    """The `user_id` a live token belongs to, or None.

    Expiry is in the WHERE clause rather than enforced by a sweeper, so an expired row stops
    authenticating the instant it expires whether or not anything has deleted it yet. The
    timestamps are ISO-8601 UTC with a fixed shape, which makes string comparison correct.
    """
    row = conn.execute(
        "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
        (token_hash(token), now_iso()),
    ).fetchone()
    if row is None:
        return None
    return str(row["user_id"] if isinstance(row, dict) else row[0])


def revoke_session(conn: sqlite3.Connection, token: str) -> int:
    cursor = conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
    return int(cursor.rowcount)
