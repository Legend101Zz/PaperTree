"""AI threads, messages, citations, runs and summaries (contracts.md §1.1, §2.5, §3.4, §4). S5.

THE RULE 0005 IS BUILT ON, FOR THIS MODULE. A thread belongs to the PAPER (``paper_owners``), never
to a parse generation, so a re-parse cannot delete a conversation. Each message records the
generation its answer was grounded in; each citation is a whole server-minted Anchor
(``anchor_json``), with ``block_id`` kept as a HINT only (AGENTS.md §4: a bare block id survives a
re-parse 3.3% of the time). Runs (``ai_runs``) are the observability record of journey E and the
authority for the agent's paper tools: a run token's sha256, its expiry and ``status='running'``
are what ``run_grant`` checks.

WHAT IS ADDITIVE TO §1.1, SAID ONCE HERE. §1.1 names ``create_thread`` … ``get_thread`` and fixes
the run and usage signatures; the routes need more reads and writes than that, so this module adds
(owner-first, like everything else): ``list_messages``, ``get_message``, ``delete_thread``,
``delete_messages``, ``put_citations``, ``list_citations``, ``set_agent_state``,
``live_run_for_thread``, ``get_run``, ``latest_run``, ``extend_run``, ``assign_run_handles``,
``run_handles``, ``thread_handles``, ``record_tool_request`` and ``put_summary``.
``tests/test_contract_signatures.py`` pins the §1.1 ones and the S0 proposals; ``test_ai.py`` pins
the behaviour of all of them.

TIMES. Every time this module writes is ``YYYY-MM-DDTHH:MM:SS.ffffff+00:00`` (``_now``): fixed
width, so the ``started_at >= since`` comparisons behind the spend cap and ``GET /usage`` are exact
string comparisons that the ``ai_runs_by_owner (owner_id, started_at)`` index can serve. A ``since``
from a caller is normalised to the same shape first (``normalise_time``). The API turns stored
times into contracts.md §0's wire shape on the way out.

THE ONE UN-OWNED READ. ``run_grant`` takes a run id and a token hash and no owner: the run token IS
the credential (contracts.md §1.1, the same exception class as ``AgentDataHandle``). It returns the
grant's ``user_id``; the caller checks status and expiry and then calls ``owner_for``.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Final

from ._support import Row, client_json, to_json
from .errors import PaperNotFound
from .highlights import SQLITE_INTEGER_MAX
from .ids import DerivationId, OwnerId, PaperId, new_id

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

THREAD_KINDS: Final = frozenset({"explain", "ask"})
RUN_KINDS: Final = frozenset({"explain", "ask", "summary"})
MESSAGE_ROLES: Final = frozenset({"user", "assistant"})
MESSAGE_STATUSES: Final = frozenset({"streaming", "complete", "partial", "error", "aborted"})
#: ``finish_run`` moves a run OUT of ``running`` into one of these; the token dies with it.
FINISHED_RUN_STATUSES: Final = frozenset({"done", "error", "aborted"})
#: ``derivations.kind`` of a paper summary (contracts.md §1 0005 index, §2.5).
SUMMARY_KIND: Final = "paper_summary"
#: A handle the API issues for one block in one run: ``b`` and a positive number (0005's CHECK is
#: ``handle GLOB 'b[0-9]*'``; this module mints from ``b1``).
HANDLE: Final = re.compile(r"b([0-9]{1,9})")

#: The columns ``finish_run(**usage)`` may set. Anything else is a ``TypeError``: a typo'd keyword
#: would otherwise be a silently missing number in journey E's record.
_FINISH_TEXT: Final = frozenset(
    {"status", "provider", "model", "agent_sdk", "stop_reason", "error_code", "message_id"}
)
_FINISH_INT: Final = frozenset(
    {
        "retries",
        "tool_calls",
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
        "first_text_ms",
        "latency_ms",
    }
)
_FINISH_REAL: Final = frozenset({"cost_usd_est"})


class AiRecordNotFound(LookupError):
    """A thread, message or run that is not this owner's (or does not exist): the same answer."""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def normalise_time(value: str | datetime) -> str:
    """A time in this module's stored shape, so string comparison is time comparison.

    Accepts an aware ``datetime`` or an ISO-8601 string with an offset or ``Z``. A time with no
    zone is refused (``ValueError``) rather than read in the server's zone.
    """
    moment = datetime.fromisoformat(value) if isinstance(value, str) else value
    if moment.tzinfo is None:
        raise ValueError(f"{value!r} has no time zone")
    return moment.astimezone(UTC).isoformat(timespec="microseconds")


def _int_or_none(name: str, value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an int, got {type(value).__name__}")
    if not 0 <= value <= SQLITE_INTEGER_MAX:
        raise ValueError(f"{name}={value} is outside 0..{SQLITE_INTEGER_MAX}")
    return value


def _real_or_none(name: str, value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError(f"{name} must be a number, got {type(value).__name__}")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{name}={value!r} must be a finite number >= 0")
    return number


def _strip_resolution(anchor: Mapping[str, Any]) -> dict[str, Any]:
    """contracts.md §2.4: a stored Anchor never carries the client's T0 cache."""
    return {key: value for key, value in anchor.items() if key != "resolution"}


def handle_number(handle: str) -> int:
    match = HANDLE.fullmatch(handle)
    if match is None:
        raise ValueError(f"{handle!r} is not a handle (b<number>)")
    return int(match.group(1))


# ── records ──────────────────────────────────────────────────────────────────────────────────


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

    def live_at(self, moment: datetime) -> bool:
        """``status == 'running'`` and ``moment < expires_at`` (contracts.md §4)."""
        return self.status == "running" and normalise_time(moment) < normalise_time(self.expires_at)


@dataclass(frozen=True, slots=True)
class UsageBucket:
    """One run kind's share of ``GET /usage`` (``schemas.UsageBucket``)."""

    runs: int
    input_tokens: int
    output_tokens: int
    cost_usd_est: float


@dataclass(frozen=True, slots=True)
class UsageTotals:
    """``GET /usage`` (contracts.md §2.5) before the API adds ``since`` and ``budget_usd``.

    CHANGED FROM S0's PROPOSAL: ``by_kind`` maps each kind to a :class:`UsageBucket` (runs,
    tokens, cost), not to a bare run count, because that is the shape §2.5's ``by_kind`` has on the
    wire (``schemas.UsageBucket``) and a count alone cannot fill it.
    """

    runs: int
    input_tokens: int
    output_tokens: int
    cost_usd_est: float
    #: ``explain``, ``ask`` and ``summary``, always all three.
    by_kind: Mapping[str, UsageBucket]


@dataclass(frozen=True, slots=True)
class CitationIn:
    """One citation of an assistant message, as the API minted it (contracts.md §3.4)."""

    citation_id: str
    ordinal: int
    #: The handle as the model wrote it, e.g. ``b3``.
    marker: str
    #: The server-minted Anchor v1 record (``papertree_anchoring.capture_anchor``).
    anchor: Mapping[str, Any]
    generation: int
    #: A HINT only, never a foreign key (AGENTS.md §4).
    block_id: str
    page_index: int
    #: ``verify_grounding``'s verdict over the cited block; None when it could not run.
    supported: bool | None


# ── the mixin ────────────────────────────────────────────────────────────────────────────────


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
        """A new thread on one of this owner's papers. ``PaperNotFound`` if it is not theirs."""
        owner_id = self._resolve(owner)
        if kind not in THREAD_KINDS:
            raise ValueError(f"kind={kind!r} is not one of {sorted(THREAD_KINDS)}")
        if not title.strip():
            raise ValueError("a thread needs a title")
        self._owned_paper_or_raise(owner_id, paper_id)
        anchor_json = (
            None if origin_anchor is None else client_json(_strip_resolution(origin_anchor))
        )
        now = _now()
        self._conn.execute(
            "INSERT INTO ai_threads (thread_id, owner_id, paper_id, kind, title, "
            "origin_anchor_json, agent_state_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
            (thread_id, owner_id, paper_id, kind, title, anchor_json, now, now),
        )
        row = self.get_thread(owner, paper_id, thread_id)
        assert row is not None  # just written, same connection
        return row

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
        """The next message of a thread (ordinal = count so far), in one transaction."""
        owner_id = self._resolve(owner)
        if role not in MESSAGE_ROLES:
            raise ValueError(f"role={role!r} is not one of {sorted(MESSAGE_ROLES)}")
        if status not in MESSAGE_STATUSES:
            raise ValueError(f"status={status!r} is not one of {sorted(MESSAGE_STATUSES)}")
        _int_or_none("generation", generation)
        now = _now()
        with self.transaction():
            thread = self._one(
                "SELECT thread_id FROM ai_threads WHERE owner_id = ? AND thread_id = ?",
                (owner_id, thread_id),
            )
            if thread is None:
                raise AiRecordNotFound(f"no thread {thread_id}")
            ordinal_row = self._one(
                "SELECT COALESCE(MAX(ordinal) + 1, 0) AS next FROM ai_messages "
                "WHERE owner_id = ? AND thread_id = ?",
                (owner_id, thread_id),
            )
            ordinal = 0 if ordinal_row is None else int(ordinal_row["next"])
            completed_at = None if status == "streaming" else now
            self._conn.execute(
                "INSERT INTO ai_messages (message_id, owner_id, thread_id, ordinal, role, "
                "generation, content, status, error_code, run_id, created_at, completed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
                (
                    message_id,
                    owner_id,
                    thread_id,
                    ordinal,
                    role,
                    generation,
                    content,
                    status,
                    run_id,
                    now,
                    completed_at,
                ),
            )
            self._conn.execute(
                "UPDATE ai_threads SET updated_at = ? WHERE owner_id = ? AND thread_id = ?",
                (now, owner_id, thread_id),
            )
        row = self.get_message(owner, message_id)
        assert row is not None
        return row

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
        """Sets the given fields; ``None`` means unchanged. A status change touches the thread."""
        owner_id = self._resolve(owner)
        if status is not None and status not in MESSAGE_STATUSES:
            raise ValueError(f"status={status!r} is not one of {sorted(MESSAGE_STATUSES)}")
        sets: list[str] = []
        params: list[Any] = []
        for column, value in (
            ("content", content),
            ("status", status),
            ("error_code", error_code),
            ("completed_at", None if completed_at is None else normalise_time(completed_at)),
        ):
            if value is not None:
                sets.append(f"{column} = ?")
                params.append(value)
        if not sets:
            return
        with self.transaction():
            cursor = self._conn.execute(
                f"UPDATE ai_messages SET {', '.join(sets)} WHERE owner_id = ? AND message_id = ?",
                (*params, owner_id, message_id),
            )
            if cursor.rowcount == 0:
                raise AiRecordNotFound(f"no message {message_id}")
            if status is not None:
                self._conn.execute(
                    "UPDATE ai_threads SET updated_at = ? WHERE owner_id = ? AND thread_id = "
                    "(SELECT thread_id FROM ai_messages WHERE owner_id = ? AND message_id = ?)",
                    (_now(), owner_id, owner_id, message_id),
                )

    def list_threads(self, owner: OwnerId, paper_id: PaperId) -> list[Row]:
        """This owner's threads on a paper, most recently active first, with ``message_count``."""
        owner_id = self._resolve(owner)
        return self._all(
            _THREAD_SELECT + " WHERE t.owner_id = ? AND t.paper_id = ? "
            "GROUP BY t.thread_id ORDER BY t.updated_at DESC, t.thread_id DESC",
            (owner_id, paper_id),
        )

    def get_thread(self, owner: OwnerId, paper_id: PaperId, thread_id: str) -> Row | None:
        """One thread on THIS paper (a thread id from another paper is None, like a foreign one)."""
        owner_id = self._resolve(owner)
        return self._one(
            _THREAD_SELECT + " WHERE t.owner_id = ? AND t.paper_id = ? AND t.thread_id = ? "
            "GROUP BY t.thread_id",
            (owner_id, paper_id, thread_id),
        )

    def delete_thread(self, owner: OwnerId, paper_id: PaperId, thread_id: str) -> int:
        """Deletes a thread; its messages and their citations cascade. Returns rows deleted."""
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "DELETE FROM ai_threads WHERE owner_id = ? AND paper_id = ? AND thread_id = ?",
            (owner_id, paper_id, thread_id),
        )
        return cursor.rowcount

    def list_messages(self, owner: OwnerId, thread_id: str) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT message_id, thread_id, ordinal, role, generation, content, status, "
            "error_code, run_id, created_at, completed_at FROM ai_messages "
            "WHERE owner_id = ? AND thread_id = ? ORDER BY ordinal",
            (owner_id, thread_id),
        )

    def get_message(self, owner: OwnerId, message_id: str) -> Row | None:
        owner_id = self._resolve(owner)
        return self._one(
            "SELECT message_id, thread_id, ordinal, role, generation, content, status, "
            "error_code, run_id, created_at, completed_at FROM ai_messages "
            "WHERE owner_id = ? AND message_id = ?",
            (owner_id, message_id),
        )

    def delete_messages(self, owner: OwnerId, message_ids: Sequence[str]) -> int:
        """For a follow-up that failed before any SSE byte: its two messages go again."""
        owner_id = self._resolve(owner)
        deleted = 0
        with self.transaction():
            for message_id in message_ids:
                cursor = self._conn.execute(
                    "DELETE FROM ai_messages WHERE owner_id = ? AND message_id = ?",
                    (owner_id, message_id),
                )
                deleted += cursor.rowcount
        return deleted

    def set_agent_state(
        self, owner: OwnerId, thread_id: str, entries: Sequence[Mapping[str, Any]] | None
    ) -> None:
        """``ai_threads.agent_state_json``: Pi's ``exportEntries()`` as of the last turn."""
        owner_id = self._resolve(owner)
        state = None if entries is None else client_json([dict(entry) for entry in entries])
        cursor = self._conn.execute(
            "UPDATE ai_threads SET agent_state_json = ?, updated_at = ? "
            "WHERE owner_id = ? AND thread_id = ?",
            (state, _now(), owner_id, thread_id),
        )
        if cursor.rowcount == 0:
            raise AiRecordNotFound(f"no thread {thread_id}")

    # ── citations ────────────────────────────────────────────────────────────────────────

    def put_citations(self, owner: OwnerId, message_id: str, items: Sequence[CitationIn]) -> None:
        """A message's citations, replacing any it had, in one transaction."""
        owner_id = self._resolve(owner)
        rows = []
        for item in items:
            _int_or_none("ordinal", item.ordinal)
            _int_or_none("generation", item.generation)
            _int_or_none("page_index", item.page_index)
            if HANDLE.fullmatch(item.marker) is None:
                raise ValueError(f"marker={item.marker!r} is not a handle")
            anchor = _strip_resolution(item.anchor)
            rows.append(
                (
                    item.citation_id,
                    owner_id,
                    message_id,
                    item.ordinal,
                    item.marker,
                    client_json(anchor),
                    item.generation,
                    item.block_id,
                    item.page_index,
                    None if item.supported is None else int(item.supported),
                )
            )
        with self.transaction():
            owned = self._one(
                "SELECT message_id FROM ai_messages WHERE owner_id = ? AND message_id = ?",
                (owner_id, message_id),
            )
            if owned is None:
                raise AiRecordNotFound(f"no message {message_id}")
            self._conn.execute(
                "DELETE FROM ai_citations WHERE owner_id = ? AND message_id = ?",
                (owner_id, message_id),
            )
            self._conn.executemany(
                "INSERT INTO ai_citations (citation_id, owner_id, message_id, ordinal, marker, "
                "anchor_json, generation, block_id, page_index, supported) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )

    def list_citations(self, owner: OwnerId, message_ids: Sequence[str]) -> list[Row]:
        """Citations of the given messages, by message then ordinal; ``anchor`` parsed."""
        owner_id = self._resolve(owner)
        out: list[Row] = []
        for message_id in message_ids:
            for row in self._all(
                "SELECT citation_id, message_id, ordinal, marker, anchor_json, generation, "
                "block_id, page_index, supported FROM ai_citations "
                "WHERE owner_id = ? AND message_id = ? ORDER BY ordinal",
                (owner_id, message_id),
            ):
                row["anchor"] = json.loads(row.pop("anchor_json"))
                supported = row["supported"]
                row["supported"] = None if supported is None else bool(supported)
                out.append(row)
        return out

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
        """A run in ``status='running'``. ``PaperNotFound`` if the paper is not this owner's."""
        owner_id = self._resolve(owner)
        if kind not in RUN_KINDS:
            raise ValueError(f"kind={kind!r} is not one of {sorted(RUN_KINDS)}")
        if not re.fullmatch(r"[0-9a-f]{64}", token_sha256):
            raise ValueError("token_sha256 must be 64 lowercase hex digits")
        _int_or_none("generation", generation)
        self._owned_paper_or_raise(owner_id, paper_id)
        self._conn.execute(
            "INSERT INTO ai_runs (run_id, owner_id, paper_id, generation, kind, thread_id, "
            "message_id, token_sha256, datamark, expires_at, status, code_path, prompt_version, "
            "request_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)",
            (
                run_id,
                owner_id,
                paper_id,
                generation,
                kind,
                thread_id,
                message_id,
                token_sha256,
                datamark,
                normalise_time(expires_at),
                code_path,
                prompt_version,
                request_id,
                _now(),
            ),
        )

    def finish_run(self, owner: OwnerId, run_id: str, **usage: Any) -> None:
        """Ends a RUNNING run: ``status`` (``done|error|aborted``, required) plus its usage.

        Only a running run is updated, so a second finish (a cancel racing the stream's own end)
        is a no-op and the first record stands. ``finished_at`` defaults to now. An unknown keyword
        is a ``TypeError``.
        """
        owner_id = self._resolve(owner)
        status = usage.get("status")
        if status not in FINISHED_RUN_STATUSES:
            raise ValueError(f"status={status!r} is not one of {sorted(FINISHED_RUN_STATUSES)}")
        unknown = set(usage) - _FINISH_TEXT - _FINISH_INT - _FINISH_REAL - {"finished_at"}
        if unknown:
            raise TypeError(f"finish_run: unknown fields {sorted(unknown)}")
        sets: list[str] = ["finished_at = ?"]
        finished_at = usage.get("finished_at")
        params: list[Any] = [_now() if finished_at is None else normalise_time(finished_at)]
        for name in sorted(set(usage) - {"finished_at"}):
            value = usage[name]
            if name in _FINISH_INT:
                value = _int_or_none(name, value)
            elif name in _FINISH_REAL:
                value = _real_or_none(name, value)
            elif value is not None and not isinstance(value, str):
                raise TypeError(f"{name} must be a string")
            sets.append(f"{name} = ?")
            params.append(value)
        self._conn.execute(
            f"UPDATE ai_runs SET {', '.join(sets)} "
            "WHERE owner_id = ? AND run_id = ? AND status = 'running'",
            (*params, owner_id, run_id),
        )

    def extend_run(self, owner: OwnerId, run_id: str, *, expires_at: str, retries: int) -> None:
        """For the API's one retry (contracts.md §3.4): a new expiry and the retry count."""
        owner_id = self._resolve(owner)
        self._conn.execute(
            "UPDATE ai_runs SET expires_at = ?, retries = ? "
            "WHERE owner_id = ? AND run_id = ? AND status = 'running'",
            (normalise_time(expires_at), _int_or_none("retries", retries), owner_id, run_id),
        )

    def get_run(self, owner: OwnerId, run_id: str) -> Row | None:
        """One run, WITHOUT ``token_sha256`` and ``datamark`` (neither leaves this layer)."""
        owner_id = self._resolve(owner)
        return self._one(_RUN_SELECT + " WHERE owner_id = ? AND run_id = ?", (owner_id, run_id))

    def live_run_for_thread(self, owner: OwnerId, thread_id: str) -> Row | None:
        """A run still ``running`` and unexpired on this thread: the 409 ``busy`` check."""
        owner_id = self._resolve(owner)
        return self._one(
            _RUN_SELECT + " WHERE owner_id = ? AND thread_id = ? AND status = 'running' "
            "AND expires_at > ? ORDER BY started_at DESC LIMIT 1",
            (owner_id, thread_id, _now()),
        )

    def latest_run(
        self, owner: OwnerId, paper_id: PaperId, *, kind: str, generation: int | None = None
    ) -> Row | None:
        """The most recent run of ``kind`` on a paper (and generation, when given)."""
        owner_id = self._resolve(owner)
        if generation is None:
            return self._one(
                _RUN_SELECT + " WHERE owner_id = ? AND paper_id = ? AND kind = ? "
                "ORDER BY started_at DESC, run_id DESC LIMIT 1",
                (owner_id, paper_id, kind),
            )
        return self._one(
            _RUN_SELECT + " WHERE owner_id = ? AND paper_id = ? AND kind = ? AND generation = ? "
            "ORDER BY started_at DESC, run_id DESC LIMIT 1",
            (owner_id, paper_id, kind, generation),
        )

    def put_run_handles(
        self, owner: OwnerId, run_id: str, generation: int, pairs: Sequence[tuple[str, str]]
    ) -> None:
        """``pairs`` are ``(handle, block_id)``, e.g. ``("b3", "blk_…")``.

        Idempotent for a pair already stored. A handle that already names ANOTHER block (or a
        block that already has another handle) in this run is a ``ValueError``: one handle, one
        block, for the whole run, or a citation could point at the wrong passage.
        """
        owner_id = self._resolve(owner)
        _int_or_none("generation", generation)
        for handle, _block in pairs:
            handle_number(handle)
        with self.transaction():
            self._run_owned_or_raise(owner_id, run_id)
            for handle, block_id in pairs:
                self._conn.execute(
                    "INSERT OR IGNORE INTO ai_run_handles (owner_id, run_id, handle, block_id, "
                    "generation) VALUES (?, ?, ?, ?, ?)",
                    (owner_id, run_id, handle, block_id, generation),
                )
                stored = self._one(
                    "SELECT block_id FROM ai_run_handles WHERE run_id = ? AND handle = ?",
                    (run_id, handle),
                )
                if stored is None or stored["block_id"] != block_id:
                    raise ValueError(f"{handle} already names another block in {run_id}")

    def assign_run_handles(
        self, owner: OwnerId, run_id: str, generation: int, block_ids: Sequence[str]
    ) -> list[str]:
        """The handle for each block, FIRST-SEEN: a block this run already has keeps its handle,
        a new one gets the next number. One transaction; returns handles in ``block_ids`` order."""
        owner_id = self._resolve(owner)
        _int_or_none("generation", generation)
        with self.transaction():
            self._run_owned_or_raise(owner_id, run_id)
            known = {
                str(row["block_id"]): str(row["handle"])
                for row in self._all(
                    "SELECT handle, block_id FROM ai_run_handles WHERE owner_id = ? AND run_id = ?",
                    (owner_id, run_id),
                )
            }
            next_number = 1 + max((handle_number(h) for h in known.values()), default=0)
            out: list[str] = []
            for block_id in block_ids:
                handle = known.get(block_id)
                if handle is None:
                    handle = f"b{next_number}"
                    next_number += 1
                    known[block_id] = handle
                    self._conn.execute(
                        "INSERT INTO ai_run_handles (owner_id, run_id, handle, block_id, "
                        "generation) VALUES (?, ?, ?, ?, ?)",
                        (owner_id, run_id, handle, block_id, generation),
                    )
                out.append(handle)
        return out

    def run_handles(self, owner: OwnerId, run_id: str) -> dict[str, str]:
        """``handle -> block_id`` for one run, in handle order."""
        owner_id = self._resolve(owner)
        rows = self._all(
            "SELECT handle, block_id FROM ai_run_handles WHERE owner_id = ? AND run_id = ?",
            (owner_id, run_id),
        )
        pairs = sorted(
            ((str(r["handle"]), str(r["block_id"])) for r in rows),
            key=lambda pair: handle_number(pair[0]),
        )
        return dict(pairs)

    def thread_handles(self, owner: OwnerId, thread_id: str) -> list[tuple[str, str]]:
        """Every ``(handle, block_id)`` earlier runs of this thread issued, oldest run first, the
        first mapping of each handle and of each block winning. A follow-up's run starts from
        these, so the ``[b4]`` a model reads in its own history still means the same passage."""
        owner_id = self._resolve(owner)
        rows = self._all(
            "SELECT h.handle, h.block_id, r.started_at, r.run_id FROM ai_run_handles h "
            "JOIN ai_runs r ON r.owner_id = h.owner_id AND r.run_id = h.run_id "
            "WHERE h.owner_id = ? AND r.thread_id = ?",
            (owner_id, thread_id),
        )
        rows.sort(key=lambda r: (r["started_at"], r["run_id"], handle_number(str(r["handle"]))))
        by_handle: dict[str, str] = {}
        taken: set[str] = set()
        for row in rows:
            handle, block_id = str(row["handle"]), str(row["block_id"])
            if handle in by_handle or block_id in taken:
                continue
            by_handle[handle] = block_id
            taken.add(block_id)
        return sorted(by_handle.items(), key=lambda pair: handle_number(pair[0]))

    def record_tool_request(
        self, owner: OwnerId, run_id: str, entry: Mapping[str, Any], *, cap: int
    ) -> int | None:
        """Appends one tool request to ``ai_runs.tool_calls_json`` if the run has had fewer than
        ``cap``; returns the new count, or None when the cap is reached (contracts.md §4: the 17th
        request of a run is 429). One UPDATE, so two concurrent requests cannot both be the 16th.
        """
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "UPDATE ai_runs SET tool_calls_json = json_insert(COALESCE(tool_calls_json, '[]'), "
            "'$[#]', json(?)) WHERE owner_id = ? AND run_id = ? "
            "AND json_array_length(COALESCE(tool_calls_json, '[]')) < ?",
            (client_json(dict(entry)), owner_id, run_id, cap),
        )
        if cursor.rowcount == 0:
            return None
        row = self._one(
            "SELECT json_array_length(tool_calls_json) AS n FROM ai_runs "
            "WHERE owner_id = ? AND run_id = ?",
            (owner_id, run_id),
        )
        return None if row is None else int(row["n"])

    def run_grant(self, run_id: str, token_sha256: str) -> RunGrant | None:
        """THE ONE UN-OWNED READ (contracts.md §1.1), the same exception class as
        ``AgentDataHandle``: a run token is the credential, so there is no owner to pass yet.

        Returns the grant for a matching (run, token hash) whatever its status; the caller checks
        ``status == 'running'`` and the expiry (``RunGrant.live_at``), then calls ``owner_for``.
        """
        row = self._one(
            "SELECT owner_id, paper_id, generation, kind, status, expires_at, datamark "
            "FROM ai_runs WHERE run_id = ? AND token_sha256 = ?",
            (run_id, token_sha256),
        )
        if row is None:
            return None
        return RunGrant(
            user_id=str(row["owner_id"]),
            paper_id=str(row["paper_id"]),
            generation=int(row["generation"]),
            kind=str(row["kind"]),
            status=str(row["status"]),
            expires_at=str(row["expires_at"]),
            datamark=str(row["datamark"]),
        )

    def cost_since(self, owner: OwnerId, since: str) -> float:
        """The estimated spend of runs STARTED at or after ``since`` (``ai_runs.cost_usd_est``).
        A run still running has no cost yet and counts 0 until it finishes."""
        owner_id = self._resolve(owner)
        row = self._one(
            "SELECT COALESCE(SUM(cost_usd_est), 0.0) AS cost FROM ai_runs "
            "WHERE owner_id = ? AND started_at >= ?",
            (owner_id, normalise_time(since)),
        )
        return 0.0 if row is None else float(row["cost"])

    def usage_since(self, owner: OwnerId, since: str) -> UsageTotals:
        owner_id = self._resolve(owner)
        rows = self._all(
            "SELECT kind, COUNT(*) AS runs, COALESCE(SUM(input_tokens), 0) AS input_tokens, "
            "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
            "COALESCE(SUM(cost_usd_est), 0.0) AS cost FROM ai_runs "
            "WHERE owner_id = ? AND started_at >= ? GROUP BY kind",
            (owner_id, normalise_time(since)),
        )
        by_kind = {kind: UsageBucket(0, 0, 0, 0.0) for kind in ("explain", "ask", "summary")}
        for row in rows:
            by_kind[str(row["kind"])] = UsageBucket(
                runs=int(row["runs"]),
                input_tokens=int(row["input_tokens"]),
                output_tokens=int(row["output_tokens"]),
                cost_usd_est=float(row["cost"]),
            )
        return UsageTotals(
            runs=sum(b.runs for b in by_kind.values()),
            input_tokens=sum(b.input_tokens for b in by_kind.values()),
            output_tokens=sum(b.output_tokens for b in by_kind.values()),
            cost_usd_est=sum(b.cost_usd_est for b in by_kind.values()),
            by_kind=by_kind,
        )

    # ── summaries (a derivation of kind 'paper_summary') ─────────────────────────────────

    def get_summary(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: int,
        prompt_hash: str,
        model_id: str,
    ) -> Row | None:
        """The cached summary for (paper, generation, prompt version, model), ``content``
        parsed. 0005's unique index makes it at most one row."""
        owner_id = self._resolve(owner)
        row = self._one(
            "SELECT derivation_id, paper_id, generation, model_id, prompt_hash, content, "
            "derived_from, created_at FROM derivations WHERE owner_id = ? AND paper_id = ? "
            "AND generation = ? AND kind = ? AND prompt_hash = ? AND model_id = ?",
            (owner_id, paper_id, generation, SUMMARY_KIND, prompt_hash, model_id),
        )
        if row is None:
            return None
        row["content"] = json.loads(row["content"])
        row["derived_from"] = json.loads(row["derived_from"])
        return row

    def put_summary(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: int,
        *,
        prompt_hash: str,
        model_id: str,
        content: Mapping[str, Any],
        derived_from: Sequence[str],
    ) -> DerivationId:
        """Stores a summary, REPLACING the cached one for the same key (``regenerate``), in one
        transaction. ``derived_from`` must name at least one block (0001's CHECK: a derivation
        that points at no source block is ungrounded)."""
        owner_id = self._resolve(owner)
        if not derived_from:
            raise ValueError("a summary must cite at least one block")
        if (
            self._one(
                "SELECT generation FROM papers WHERE owner_id = ? AND paper_id = ? AND generation = ?",
                (owner_id, paper_id, generation),
            )
            is None
        ):
            raise PaperNotFound(paper_id)
        derivation_id = new_id("drv")
        with self.transaction():
            self._conn.execute(
                "DELETE FROM derivations WHERE owner_id = ? AND paper_id = ? AND generation = ? "
                "AND kind = ? AND prompt_hash = ? AND model_id = ?",
                (owner_id, paper_id, generation, SUMMARY_KIND, prompt_hash, model_id),
            )
            self._conn.execute(
                "INSERT INTO derivations (derivation_id, owner_id, paper_id, generation, "
                "parent_derivation_id, kind, author_kind, model_id, prompt_hash, content, "
                "derived_from, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'model', ?, ?, ?, ?, ?)",
                (
                    derivation_id,
                    owner_id,
                    paper_id,
                    generation,
                    SUMMARY_KIND,
                    model_id,
                    prompt_hash,
                    client_json(dict(content)),
                    to_json(list(dict.fromkeys(derived_from))),
                    _now(),
                ),
            )
        return DerivationId(derivation_id)

    # ── internals ────────────────────────────────────────────────────────────────────────

    def _owned_paper_or_raise(self, owner_id: str, paper_id: str) -> None:
        if (
            self._one(
                "SELECT paper_id FROM paper_owners WHERE owner_id = ? AND paper_id = ?",
                (owner_id, paper_id),
            )
            is None
        ):
            raise PaperNotFound(paper_id)

    def _run_owned_or_raise(self, owner_id: str, run_id: str) -> None:
        if (
            self._one(
                "SELECT run_id FROM ai_runs WHERE owner_id = ? AND run_id = ?", (owner_id, run_id)
            )
            is None
        ):
            raise AiRecordNotFound(f"no run {run_id}")


_THREAD_SELECT: Final = (
    "SELECT t.thread_id, t.paper_id, t.kind, t.title, t.origin_anchor_json, t.agent_state_json, "
    "t.created_at, t.updated_at, COUNT(m.message_id) AS message_count FROM ai_threads t "
    "LEFT JOIN ai_messages m ON m.owner_id = t.owner_id AND m.thread_id = t.thread_id"
)

#: Every ``ai_runs`` column except ``owner_id``, ``token_sha256`` and ``datamark``.
_RUN_SELECT: Final = (
    "SELECT run_id, paper_id, generation, kind, thread_id, message_id, expires_at, status, "
    "code_path, provider, model, agent_sdk, prompt_version, request_id, stop_reason, error_code, "
    "retries, tool_calls, tool_calls_json, input_tokens, output_tokens, cache_read_tokens, "
    "cache_write_tokens, reasoning_tokens, cost_usd_est, first_text_ms, latency_ms, started_at, "
    "finished_at FROM ai_runs"
)
