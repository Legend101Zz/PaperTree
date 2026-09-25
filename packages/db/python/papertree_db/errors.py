"""Errors raised by :mod:`papertree_db`."""

from __future__ import annotations

from typing import Literal

#: The contract error codes (contracts.md §2.9) a highlight write can be refused with, as 422s.
HighlightRejectCode = Literal["validation_failed", "anchor_incomplete", "anchor_mismatch"]


class OwnershipError(Exception):
    """Raised for an ``OwnerId`` this connection's ``create_user`` / ``owner_for`` did not mint."""


class MigrationError(Exception):
    """Raised when the migrations on disk disagree with what the database records."""


class PaperNotFound(LookupError):
    """The owner has no ``paper_owners`` row for that paper id.

    ONE error for "does not exist" and "belongs to someone else", deliberately: telling them apart
    is an existence oracle over content-derived ids (the same reason the API answers 404, not 403).
    """


class GenerationNotFound(LookupError):
    """That parse generation of the paper was never stored, or has since been deleted."""


class HighlightRejected(ValueError):
    """A highlight body the store refuses, BEFORE any row is written (or after a rollback).

    ``code`` is the contract's error code, so the HTTP layer maps it to a 422 without re-deriving
    why; ``detail`` is a sentence safe to show a user (contracts.md §0).
    """

    def __init__(self, code: HighlightRejectCode, detail: str) -> None:
        super().__init__(detail)
        self.code: HighlightRejectCode = code
        self.detail = detail


class HighlightConflict(HighlightRejected):
    """An idempotent create found the ``highlight_id`` (or an anchor id) already stored with a
    DIFFERENT body. The contract has no dedicated code for it, so it is ``validation_failed``."""

    def __init__(self, detail: str) -> None:
        super().__init__("validation_failed", detail)
