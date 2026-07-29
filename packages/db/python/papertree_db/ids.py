"""Identifier types for :mod:`papertree_db`.

The Python twin of ``packages/db/src/ids.ts``. ``PaperId``/``BlockId``/``Generation`` are
``NewType``s: distinct to mypy, plain ``str``/``int`` at runtime, so they cost nothing and
still stop a ``paper_id`` being passed where a ``block_id`` was meant.

``OwnerId`` is not a ``NewType``. It is an opaque object whose constructor refuses to run
unless it is handed the module-private mint token, so — unlike a ``NewType`` — it CANNOT be
produced by writing ``OwnerId("usr_x")``. That difference is the whole point: the acceptance
criterion for the owner is "raises", and a ``NewType`` cannot raise.
"""

from __future__ import annotations

import os
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

    Minted in exactly one place — ``PaperTreeDb.authenticate`` / ``create_user`` — which
    requires a matching ``users`` row. ``OwnerId("usr_x")`` raises ``OwnershipError``, and
    mypy rejects passing a bare ``str`` to any helper that wants one, so the unsafe call
    fails in both directions.
    """

    __slots__ = ("_mint", "_value")

    def __init__(self, value: str, mint: object = None) -> None:
        if mint is not _MINT:
            raise OwnershipError(
                "OwnerId cannot be constructed directly. It is minted by "
                "PaperTreeDb.authenticate() / create_user(), which require a users row."
            )
        self._value = value
        self._mint = _MINT

    @property
    def value(self) -> str:
        """The ``user_id``. Refuses on an instance that did not go through ``__init__``.

        WHY THIS RE-CHECKS. A guarded ``__init__`` is not enough on its own: an adversarial
        review built a working ``OwnerId`` with
        ``o = object.__new__(OwnerId); object.__setattr__(o, "_value", victim_user_id)``,
        which never calls ``__init__``, satisfies ``isinstance``, and then read AND wrote
        another tenant's highlight — findings.md §F1, reproduced. ``_mint`` is a second
        slot that only ``__init__`` sets, so a bypassed constructor leaves it unset and
        every consumer of ``.value`` — i.e. every bind site in the package — raises here.
        """
        if getattr(self, "_mint", None) is not _MINT:
            raise OwnershipError(
                "this OwnerId did not come from PaperTreeDb.authenticate() / create_user(); "
                "its constructor was bypassed, so it authorises nothing."
            )
        return self._value

    def __str__(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return f"OwnerId({self._value!r})"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, OwnerId) and other._value == self._value

    def __hash__(self) -> int:
        return hash(("OwnerId", self._value))


def _mint_owner(value: str) -> OwnerId:
    """Internal: the only call site that may hand over the mint token."""
    return OwnerId(value, _MINT)


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
