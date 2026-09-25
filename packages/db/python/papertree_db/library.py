"""The library: one row per paper the owner has uploaded, parsed or not (contracts.md §1.1, §2.2).

S1 OWNS THIS MODULE. S0 commits it as STUBS with the signatures contracts.md §1.1 fixes, so that
S1, S3 and wave-2 code can be written against ``db.<method>`` before the bodies exist. Every stub
raises ``NotImplementedError`` naming its owner; ``tests/test_contract_signatures.py`` pins the
signatures and lists which methods are still stubs.

``LibraryRow``'s fields are S0's PROPOSAL, derived from ``LibraryPaper`` (§2.2) minus what the API
derives (``processing``, ``title`` fallback). The contract fixes the method, not these fields; S1
may change them before the first caller exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object


@dataclass(frozen=True, slots=True)
class LibraryRow:
    """One ``paper_owners`` row joined to its promoted generation and its latest job."""

    paper_id: str
    source_hash: str
    original_filename: str | None
    byte_size: int | None
    page_count: int | None
    created_at: str
    #: The promoted generation, or None before the first promotion.
    generation: int | None
    #: ``papers.status`` of the promoted generation (``complete`` / ``partial``), or None.
    paper_status: str | None
    parser_version: str | None
    #: ``metadata.title.value`` of the promoted generation, if the parser found one.
    title: str | None
    latest_job_id: str | None
    job_state: str | None
    highlight_count: int


class LibraryMixin(_Base):
    __slots__ = ()

    def register_upload(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        source_hash: str,
        original_filename: str | None,
        byte_size: int,
        page_count: int | None,
    ) -> None:
        """INSERT OR IGNORE into ``paper_owners``, then UPDATE the four columns 0005 added."""
        raise NotImplementedError("S1 implements register_upload (contracts.md §1.1)")

    def set_latest_job(self, owner: OwnerId, paper_id: PaperId, job_id: str) -> None:
        raise NotImplementedError("S1 implements set_latest_job (contracts.md §1.1)")

    def next_generation(self, owner: OwnerId, paper_id: PaperId) -> int:
        raise NotImplementedError("S1 implements next_generation (contracts.md §1.1)")

    def list_library(self, owner: OwnerId) -> list[LibraryRow]:
        """One row per ``paper_owners`` row (fixes N4: one row per GENERATION today)."""
        raise NotImplementedError("S1 implements list_library (contracts.md §1.1)")
