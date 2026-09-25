"""The library: one row per paper the owner has uploaded, parsed or not (contracts.md §1.1, §2.2).

S1 owns this module. contracts.md §1.1 fixes four methods (``register_upload``, ``set_latest_job``,
``next_generation``, ``list_library``); the rest are ADDITIVE and pinned beside them in
``tests/test_contract_signatures.py`` under ``PROPOSED``:

    library_row(owner, paper_id)   ``list_library`` for one paper (the 202 of an upload, GET by id)
    asset_grant(paper_id)          THE SECOND UN-OWNED READ, beside ``run_grant``; see below

WHY THIS MODULE READS ``jobs`` AND ``job_steps``. They are in the same SQLite file, keyed to the
same ``users.user_id``, and §1.1 defines ``list_library`` as "a LEFT JOIN of ``jobs`` on
``latest_job_id``". Every statement here that touches them binds ``owner_id``, like every other
statement in this package. None of them WRITES a job: ``packages/jobs`` is still the only writer.

ONE ROW PER ``paper_owners`` ROW (N4). The pre-release ``GET /papers`` was ``list_papers``: one row
per GENERATION, and nothing at all for a paper whose parse never persisted (the dead-lettered
DDPM). Here the paper is the unit: its promoted generation (if any) is LEFT JOINed, its latest parse
job (if any) is LEFT JOINed, and neither is required.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final

from ._support import Row, now_iso
from .errors import OwnershipError, PaperNotFound
from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

#: SQLite's INTEGER range; `highlights.SQLITE_INTEGER_MAX` is the exported name, restated here
#: only because importing it from `highlights` would couple two slices' modules.
_SQLITE_INTEGER_MAX: Final = 2**63 - 1

#: The job kind this module reads. `papertree_document_worker.job.PARSE_KIND`, restated: this
#: package cannot import the worker (the worker imports this package).
_PARSE: Final = "parse"


@dataclass(frozen=True, slots=True)
class LibraryRow:
    """One ``paper_owners`` row joined to its promoted generation and its latest parse job.

    The API derives ``LibraryPaper.processing``, the title fallback and the job summary's
    ``done``/``total`` from these; nothing here is a guess about what they should say.
    """

    paper_id: str
    source_hash: str
    original_filename: str | None
    byte_size: int | None
    #: What the upload measured; else the promoted generation's page count; else None.
    page_count: int | None
    created_at: str
    #: The promoted generation, or None before the first promotion.
    generation: int | None
    promoted_at: str | None
    #: ``papers.status`` of the promoted generation (``complete`` / ``partial``), or None.
    paper_status: str | None
    parser_version: str | None
    #: ``metadata.title.value`` of the promoted generation, if the parser found one.
    title: str | None
    #: ``metadata.authors[].value`` of the promoted generation, in document order.
    authors: tuple[str, ...]
    latest_job_id: str | None
    job_state: str | None
    job_attempt: int | None
    job_max_attempts: int | None
    #: The raw ``jobs.error``. It stays in the DB and the logs; the API sends only its CODE.
    job_error: str | None
    job_updated_at: str | None
    #: The generation the latest job parses (its payload; 1 for a pre-S1 payload without one).
    job_generation: int | None
    #: The latest job's ``attempt_seq`` (its payload; 1 for a pre-S1 payload without one).
    job_attempt_seq: int | None
    #: How many of its steps have committed (``job_steps.state = 'succeeded'``).
    job_steps_done: int
    #: The step it is in (``running``) or stopped at (``failed``), or None.
    job_open_step: str | None
    highlight_count: int


_ROW_SQL: Final = f"""
SELECT po.paper_id, po.source_hash, po.original_filename, po.byte_size, po.created_at,
       COALESCE(po.page_count,
                NULLIF((SELECT COUNT(*) FROM pages pg
                         WHERE pg.owner_id = po.owner_id AND pg.paper_id = po.paper_id
                           AND pg.generation = pp.generation), 0)) AS page_count,
       pp.generation, pp.promoted_at, p.status AS paper_status, p.parser_version, p.metadata,
       j.job_id AS latest_job_id, j.state AS job_state, j.attempt AS job_attempt,
       j.max_attempts AS job_max_attempts, j.error AS job_error, j.updated_at AS job_updated_at,
       j.payload AS job_payload,
       (SELECT COUNT(*) FROM job_steps s
         WHERE s.owner_id = j.owner_id AND s.job_id = j.job_id
           AND s.state = 'succeeded') AS job_steps_done,
       (SELECT s.step_name FROM job_steps s
         WHERE s.owner_id = j.owner_id AND s.job_id = j.job_id AND s.state <> 'succeeded'
         ORDER BY s.step_index DESC LIMIT 1) AS job_open_step,
       (SELECT COUNT(*) FROM highlights h
         WHERE h.owner_id = po.owner_id AND h.paper_id = po.paper_id) AS highlight_count
  FROM paper_owners po
  LEFT JOIN paper_promotions pp
         ON pp.owner_id = po.owner_id AND pp.paper_id = po.paper_id
  LEFT JOIN papers p
         ON p.owner_id = pp.owner_id AND p.paper_id = pp.paper_id AND p.generation = pp.generation
  LEFT JOIN jobs j
         ON j.owner_id = po.owner_id
        AND j.job_id = COALESCE(
              po.latest_job_id,
              -- The moment between an upload's enqueue and its `set_latest_job`, and any row
              -- 0005 could not backfill: the paper's newest parse job, as 0005 computed it.
              (SELECT j2.job_id FROM jobs j2
                WHERE j2.owner_id = po.owner_id AND j2.kind = '{_PARSE}'
                  AND json_extract(j2.payload, '$.paper_id') = po.paper_id
                ORDER BY j2.created_at DESC, j2.job_id DESC LIMIT 1))
 WHERE po.owner_id = ?
"""

#: Newest first (§2.2); the id breaks a tie between two uploads stamped in the same microsecond.
_ORDER: Final = " ORDER BY po.created_at DESC, po.paper_id DESC"


def _metadata_strings(metadata: Any) -> tuple[str | None, tuple[str, ...]]:
    """``(title, authors)`` from a stored ``papers.metadata`` JSON text. Anything malformed (a
    legacy row, a hand-written fixture) reads as "not found", never as an error: the library must
    list a paper whose metadata it cannot read."""
    if not isinstance(metadata, str):
        return None, ()
    try:
        data = json.loads(metadata)
    except ValueError:
        return None, ()
    if not isinstance(data, dict):
        return None, ()
    title_field = data.get("title")
    title = title_field.get("value") if isinstance(title_field, dict) else None
    authors = tuple(
        author["value"]
        for author in (data.get("authors") or [])
        if isinstance(author, dict) and isinstance(author.get("value"), str) and author["value"]
    )
    return (title if isinstance(title, str) and title.strip() else None), authors


def _payload_int(payload: Any, key: str) -> int | None:
    """An integer field of a job payload; 1 when absent (a pre-S1 payload), None if unreadable."""
    if not isinstance(payload, str):
        return None
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    value = data.get(key, 1) if isinstance(data, dict) else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _library_row(row: Row) -> LibraryRow:
    title, authors = _metadata_strings(row["metadata"])
    has_job = row["latest_job_id"] is not None
    return LibraryRow(
        paper_id=row["paper_id"],
        source_hash=row["source_hash"],
        original_filename=row["original_filename"],
        byte_size=row["byte_size"],
        page_count=row["page_count"],
        created_at=row["created_at"],
        generation=row["generation"],
        promoted_at=row["promoted_at"],
        paper_status=row["paper_status"],
        parser_version=row["parser_version"],
        title=title,
        authors=authors,
        latest_job_id=row["latest_job_id"],
        job_state=row["job_state"],
        job_attempt=row["job_attempt"],
        job_max_attempts=row["job_max_attempts"],
        job_error=row["job_error"],
        job_updated_at=row["job_updated_at"],
        job_generation=_payload_int(row["job_payload"], "generation") if has_job else None,
        job_attempt_seq=_payload_int(row["job_payload"], "attempt_seq") if has_job else None,
        job_steps_done=int(row["job_steps_done"] or 0),
        job_open_step=row["job_open_step"],
        highlight_count=int(row["highlight_count"]),
    )


def _bounded(name: str, value: int | None) -> None:
    """contracts.md: every integer reaching SQL is bounded by SQLite's INTEGER range."""
    if value is None:
        return
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= _SQLITE_INTEGER_MAX
    ):
        raise ValueError(
            f"{name} must be an integer from 0 to {_SQLITE_INTEGER_MAX}, got {value!r}"
        )


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
        """INSERT OR IGNORE into ``paper_owners``, then UPDATE the upload's columns, in ONE
        transaction.

        A re-upload of the same bytes is the same paper (``paper_id`` is derived from the owner
        and the bytes), so it UPDATEs: the filename is the latest one the user chose, the size and
        page count are the bytes' own. ``page_count`` None (PyMuPDF could not open the bytes: the
        parse will say why) never erases a count an earlier upload measured.

        Refused, as ``put_paper`` refuses them: a ``paper_id`` bound to another owner
        (``OwnershipError``), and a ``source_hash`` this owner already holds under ANOTHER paper id
        (``paper_owners``' ``UNIQUE (owner_id, source_hash)``: the insert would be silently
        ignored and the update would then name no row).
        """
        owner_id = self._resolve(owner)
        _bounded("byte_size", byte_size)
        _bounded("page_count", page_count)
        with self.transaction():
            self._conn.execute(
                "INSERT OR IGNORE INTO paper_owners (paper_id, owner_id, source_hash, created_at) "
                "VALUES (?, ?, ?, ?)",
                (paper_id, owner_id, source_hash, now_iso()),
            )
            bound = self._conn.execute(
                "SELECT owner_id, source_hash FROM paper_owners WHERE paper_id = ?", (paper_id,)
            ).fetchone()
            if bound is None:
                raise ValueError(
                    f"{source_hash} is already registered to this owner under another paper id"
                )
            if bound["owner_id"] != owner_id:
                raise OwnershipError(f"paper {paper_id} belongs to another owner")
            if bound["source_hash"] != source_hash:
                raise ValueError(f"paper {paper_id} is registered with a different source_hash")
            self._conn.execute(
                "UPDATE paper_owners SET original_filename = ?, byte_size = ?, "
                "page_count = COALESCE(?, page_count) WHERE owner_id = ? AND paper_id = ?",
                (original_filename, byte_size, page_count, owner_id, paper_id),
            )

    def set_latest_job(self, owner: OwnerId, paper_id: PaperId, job_id: str) -> None:
        """Points the paper at the parse job the library should show. ``PaperNotFound`` when the
        paper is not this owner's (or no longer exists)."""
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "UPDATE paper_owners SET latest_job_id = ? WHERE owner_id = ? AND paper_id = ?",
            (job_id, owner_id, paper_id),
        )
        if cursor.rowcount == 0:
            raise PaperNotFound(f"no paper {paper_id} for this owner")

    def next_generation(self, owner: OwnerId, paper_id: PaperId) -> int:
        """One past the highest generation this paper has STORED or has a parse job FOR.

        The jobs count, not only ``papers``: a re-parse that dead-lettered before it persisted
        still used its generation number, and its idempotency key
        (``parse:…:g{generation}:a{attempt_seq}``, contracts.md §2.2) names it. Handing the same
        number out again would make the next re-parse's key collide with the dead job's, and the
        enqueue would return that dead job instead of a new one. A pre-S1 parse payload has no
        ``generation``: it parsed generation 1 (the worker's hard-coded default then).
        """
        owner_id = self._resolve(owner)
        row = self._conn.execute(
            "SELECT MAX(g) AS top FROM ("
            "  SELECT MAX(generation) AS g FROM papers WHERE owner_id = ? AND paper_id = ?"
            "  UNION ALL"
            "  SELECT MAX(CAST(COALESCE(json_extract(payload, '$.generation'), 1) AS INTEGER))"
            f"   FROM jobs WHERE owner_id = ? AND kind = '{_PARSE}'"
            "    AND json_extract(payload, '$.paper_id') = ?"
            ")",
            (owner_id, paper_id, owner_id, paper_id),
        ).fetchone()
        top = row["top"]
        if top is None:
            return 1
        if int(top) >= _SQLITE_INTEGER_MAX:
            raise ValueError(f"paper {paper_id} has no generation number left")
        return int(top) + 1

    def list_library(self, owner: OwnerId) -> list[LibraryRow]:
        """One row per ``paper_owners`` row, newest first (fixes N4: one row per GENERATION
        before). A paper with no generation (queued, reading, failed) is listed; so is one with
        no job at all."""
        owner_id = self._resolve(owner)
        return [_library_row(row) for row in self._conn.execute(_ROW_SQL + _ORDER, (owner_id,))]

    def library_row(self, owner: OwnerId, paper_id: PaperId) -> LibraryRow | None:
        """``list_library``'s row for one paper, or None when it is not this owner's."""
        owner_id = self._resolve(owner)
        row = self._conn.execute(_ROW_SQL + " AND po.paper_id = ?", (owner_id, paper_id)).fetchone()
        return None if row is None else _library_row(row)

    def asset_grant(self, paper_id: PaperId) -> str | None:
        """THE SECOND UN-OWNED READ (after ``run_grant``): the ``user_id`` that owns ``paper_id``.

        For contracts.md §2.3 only: a signed asset URL (``?gen=&exp=&sig=``) stands in for the
        Bearer for ONE object, and "the API resolves ``paper_id`` → owner through
        ``paper_owners``". The caller must have VERIFIED the HMAC over exactly that paper, and
        then calls ``owner_for(user_id)`` and reads through the owner-scoped methods, as the
        agent's tool routes do with ``run_grant``. Exempt by name from the owner-first audit
        (``tests/test_typing.py``) for that reason, and for no other.
        """
        row = self._conn.execute(
            "SELECT owner_id FROM paper_owners WHERE paper_id = ?", (paper_id,)
        ).fetchone()
        return None if row is None else str(row["owner_id"])
