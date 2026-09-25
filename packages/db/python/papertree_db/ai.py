"""AI threads, messages, citations, runs and summaries (contracts.md §1.1, §2.5, §3.4, §4).

S5 OWNS THIS MODULE. S0 commits it as STUBS so the API and agent work can be written against
``db.<method>`` first. Every stub raises ``NotImplementedError`` naming its owner, and
``tests/test_contract_signatures.py`` pins the signatures.

WHERE THE CONTRACT IS SILENT, THIS IS A PROPOSAL, SAID ONCE HERE. contracts.md §1.1 gives full
parameter lists for ``create_run``, ``finish_run``, ``put_run_handles``, ``run_grant``,
``cost_since``, ``usage_since`` and ``get_summary``, and only NAMES ``create_thread``,
``append_message``, ``update_message``, ``list_threads`` and ``get_thread``. The parameters of those
five, and the fields of ``UsageTotals``, are S0's reading of §2.5 and the 0005 columns; S5 may
change them before the first caller exists.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from ._support import Row
from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object


@dataclass(frozen=True, slots=True)
class RunGrant:
    """What a run token authorises (contracts.md §1.1, §4). The caller then calls ``owner_for``."""

    user_id: str
    paper_id: str
    generation: int
    kind: str
    status: str
    expires_at: str
    datamark: str


@dataclass(frozen=True, slots=True)
class UsageTotals:
    """``GET /usage`` (contracts.md §2.5) before the API adds ``since`` and ``budget_usd``."""

    runs: int
    input_tokens: int
    output_tokens: int
    cost_usd_est: float
    #: Run counts per kind: ``explain``, ``ask``, ``summary``.
    by_kind: Mapping[str, int]


class AiMixin(_Base):
    __slots__ = ()

    # ── threads and messages ─────────────────────────────────────────────────────────────

    def create_thread(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        *,
        thread_id: str,
        kind: str,
        title: str,
        origin_anchor: Mapping[str, Any] | None,
    ) -> Row:
        raise NotImplementedError("S5 implements create_thread (contracts.md §1.1)")

    def append_message(
        self,
        owner: OwnerId,
        thread_id: str,
        *,
        message_id: str,
        role: str,
        generation: int,
        content: str,
        status: str,
        run_id: str | None = None,
    ) -> Row:
        raise NotImplementedError("S5 implements append_message (contracts.md §1.1)")

    def update_message(
        self,
        owner: OwnerId,
        message_id: str,
        *,
        content: str | None = None,
        status: str | None = None,
        error_code: str | None = None,
        completed_at: str | None = None,
    ) -> None:
        raise NotImplementedError("S5 implements update_message (contracts.md §1.1)")

    def list_threads(self, owner: OwnerId, paper_id: PaperId) -> list[Row]:
        raise NotImplementedError("S5 implements list_threads (contracts.md §1.1)")

    def get_thread(self, owner: OwnerId, paper_id: PaperId, thread_id: str) -> Row | None:
        raise NotImplementedError("S5 implements get_thread (contracts.md §1.1)")

    # ── runs ─────────────────────────────────────────────────────────────────────────────

    def create_run(
        self,
        owner: OwnerId,
        *,
        run_id: str,
        paper_id: PaperId,
        generation: int,
        kind: str,
        thread_id: str | None,
        message_id: str | None,
        token_sha256: str,
        datamark: str,
        expires_at: str,
        code_path: str,
        request_id: str | None,
        prompt_version: str | None,
    ) -> None:
        raise NotImplementedError("S5 implements create_run (contracts.md §1.1)")

    def finish_run(self, owner: OwnerId, run_id: str, **usage: Any) -> None:
        raise NotImplementedError("S5 implements finish_run (contracts.md §1.1)")

    def put_run_handles(
        self, owner: OwnerId, run_id: str, generation: int, pairs: Sequence[tuple[str, str]]
    ) -> None:
        """``pairs`` are ``(handle, block_id)``, e.g. ``("b3", "blk_…")``."""
        raise NotImplementedError("S5 implements put_run_handles (contracts.md §1.1)")

    def run_grant(self, run_id: str, token_sha256: str) -> RunGrant | None:
        """THE ONE UN-OWNED READ (contracts.md §1.1), the same exception class as
        ``AgentDataHandle``: a run token is the credential, so there is no owner to pass yet."""
        raise NotImplementedError("S5 implements run_grant (contracts.md §1.1)")

    def cost_since(self, owner: OwnerId, since: str) -> float:
        raise NotImplementedError("S5 implements cost_since (contracts.md §1.1)")

    def usage_since(self, owner: OwnerId, since: str) -> UsageTotals:
        raise NotImplementedError("S5 implements usage_since (contracts.md §1.1)")

    # ── summaries (a derivation of kind 'paper_summary'; written with create_derivation) ─────

    def get_summary(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: int,
        prompt_hash: str,
        model_id: str,
    ) -> Row | None:
        raise NotImplementedError("S5 implements get_summary (contracts.md §1.1)")
