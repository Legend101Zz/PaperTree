"""Identifier types for :mod:`papertree_db`.

The Python twin of ``packages/db/src/ids.ts``. ``PaperId``/``BlockId``/``Generation`` are
``NewType``s: distinct to mypy, plain ``str``/``int`` at runtime, so they cost nothing and
still stop a ``paper_id`` being passed where a ``block_id`` was meant.

``OwnerId`` is not a ``NewType``. It is an opaque object wrapping an UNGUESSABLE PER-CONNECTION
HANDLE — 32 bytes of CSPRNG output — and it is the Python mirror of the branded handle string in
``src/ids.ts``.

WHY A HANDLE AND NOT THE user_id, AND WHY THE GUARDED CONSTRUCTOR WAS NOT ENOUGH. The previous
design stored the ``user_id`` behind a ``_mint`` sentinel that proved only that ``__init__`` had
run. An adversarial review broke it three ways in one afternoon, each of them a full cross-tenant
read AND write — findings.md §F1 reproduced:

  * ``from papertree_db.ids import _MINT; OwnerId(victim_user_id, _MINT)`` — a leading underscore
    is a convention, not a barrier;
  * ``from papertree_db.ids import _mint_owner; _mint_owner(victim_user_id)`` — likewise
    (that helper is gone; ``mint_owner`` below replaces it and mints a handle, not a user id);
  * ``stolen = copy.copy(my_owner); stolen._value = victim_user_id`` — stdlib only, no private
    import at all. ``__slots__`` are writable and ``copy.copy`` preserves the sentinel, so the
    object passed ``isinstance``, passed the ``.value`` re-check, and bound the victim's id into
    every statement.

All three worked because ``PaperTreeDb`` checked ``owner.value in self._minted``, a set of USER
IDS — and in the deployment this package targets (one process, one long-lived connection, many
tenants) every logged-in user is in that set forever. A secret every tenant already knows, and
that appears in URLs, logs and emails, is not a secret.

So the value the check wants is now one the caller cannot name. ``OwnerId`` carries only a handle;
``PaperTreeDb._resolve`` maps handle → user_id through a dict that lives on the connection and
nowhere else. Forging the object is now pointless rather than merely awkward: an ``OwnerId`` built
by any of the three routes above holds a handle no connection ever minted, and resolution fails.
The guarded constructor is kept as a second, cheaper line of defence, but nothing rests on it.
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Final, NewType, final

from .errors import OwnershipError

PaperId = NewType("PaperId", str)
BlockId = NewType("BlockId", str)
PageId = NewType("PageId", str)
HighlightId = NewType("HighlightId", str)
AnchorId = NewType("AnchorId", str)
DerivationId = NewType("DerivationId", str)
Generation = NewType("Generation", int)

# Module-private. Not exported from __init__, not reachable from a caller who imports the
# package normally. Holding it is what "having authenticated" means.
_MINT: Final = object()


@final
class OwnerId:
    """The owner of every row this package will let you touch.

    IT IS NOT A USER ID. It wraps an opaque per-connection handle minted in exactly one place —
    ``PaperTreeDb.create_user`` / ``owner_for`` — which requires a matching ``users`` row. There
    is deliberately no way to build one from a user id: ``OwnerId("usr_x")`` raises, and even a
    successful forgery holds a handle no connection minted, so ``PaperTreeDb._resolve`` rejects
    it. mypy also rejects passing a bare ``str`` to any helper that wants one, so the unsafe call
    fails in both directions.
    """

    __slots__ = ("_handle", "_mint")

    def __init__(self, handle: str, mint: object = None) -> None:
        if mint is not _MINT:
            raise OwnershipError(
                "OwnerId cannot be constructed directly. It is minted by "
                "PaperTreeDb.create_user() / owner_for(), which require a users row."
            )
        self._handle = handle
        self._mint = _MINT

    @property
    def handle(self) -> str:
        """The opaque per-connection handle. NOT a user id; it names nothing outside the process.

        It is a bearer secret: whoever holds it acts as that tenant on that connection, exactly
        like the branded handle string on the TypeScript side. So it must never be logged,
        serialised, stored in a row, or put in a URL — which is why ``__repr__`` and ``__str__``
        below redact it, and why nothing in the package ever binds it into a statement.

        Only ``PaperTreeDb._resolve`` and ``JobStore._resolve`` should read this.
        """
        if getattr(self, "_mint", None) is not _MINT:
            raise OwnershipError(
                "this OwnerId did not come from PaperTreeDb.create_user() / owner_for(); "
                "its constructor was bypassed, so it authorises nothing."
            )
        return self._handle

    def __str__(self) -> str:
        return "OwnerId(<opaque handle>)"

    def __repr__(self) -> str:
        # Deliberately NOT the handle. An owner falling into a log line or a traceback must not
        # hand the reader a working credential; the old repr printed the user id, which made the
        # forgery in this module's docstring copy-pasteable.
        return "OwnerId(<opaque handle>)"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, OwnerId) and other._handle == self._handle

    def __hash__(self) -> int:
        return hash(("OwnerId", self._handle))


def mint_owner() -> tuple[str, OwnerId]:
    """Mints a fresh, unguessable handle and the :class:`OwnerId` that carries it.

    Returns ``(handle, owner)``. The caller MUST record ``handle -> user_id`` in a table that
    lives on its own connection and hand out only ``owner``; resolution is what confers
    authority, not the object. Public on purpose: an ``OwnerId`` whose handle no connection has
    recorded authorises nothing, so there is nothing to protect here — and the alternative was
    two packages importing an underscored name from each other, which is the convention this
    module's docstring records as having failed.

    32 bytes of CSPRNG output, URL-safe base64, ``own_`` prefixed.
    """
    handle = f"own_{secrets.token_urlsafe(32)}"
    return handle, OwnerId(handle, _MINT)


_CROCKFORD: Final = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _ulid(now_ms: int | None = None) -> str:
    """A 26-character Crockford base32 ULID: 48 bits of ms time, 80 bits of randomness."""
    millis = int(time.time() * 1000) if now_ms is None else now_ms
    time_part = ""
    for _ in range(10):
        time_part = _CROCKFORD[millis % 32] + time_part
        millis //= 32
    random_part = "".join(_CROCKFORD[b % 32] for b in os.urandom(16))
    return time_part + random_part


def new_id(prefix: str) -> str:
    """Mints a prefixed ULID, e.g. ``new_id("ppr")``."""
    return f"{prefix}_{_ulid()}"


def generation(value: int) -> Generation:
    """Validates and tags a parse generation (DESIGN.md D13: integer >= 1)."""
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"generation must be an integer >= 1, got {value!r}")
    return Generation(value)
