"""Errors raised by :mod:`papertree_db`."""

from __future__ import annotations


class OwnershipError(Exception):
    """Raised when an ``OwnerId`` was not minted by ``PaperTreeDb.authenticate``."""


class MigrationError(Exception):
    """Raised when the migrations on disk disagree with what the database records."""
