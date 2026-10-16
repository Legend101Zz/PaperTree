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
import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final

from ._support import Row, now_iso
from .errors import OwnershipError, PaperNotFound
from .ids import OwnerId, PaperId
from .reading import ReadingState, reading_state_from

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

_log = logging.getLogger(__name__)

#: SQLite's INTEGER range; `highlights.SQLITE_INTEGER_MAX` is the exported name, restated here
#: only because importing it from `highlights` would couple two slices' modules.
_SQLITE_INTEGER_MAX: Final = 2**63 - 1

#: The longest display name, enforced here and by the API rather than by a CHECK, so relaxing it
#: later needs no table rebuild (0006).
DISPLAY_NAME_MAX: Final = 60

#: The job kind this module reads. `papertree_document_worker.job.PARSE_KIND`, restated: this
#: package cannot import the worker (the worker imports this package).
_PARSE: Final = "parse"


@dataclass(frozen=True, slots=True)
class ShelfTopic:
    """The topic a paper is ACCEPTED under (#193). A suggestion is not shown on the shelf: it is an
    offer the UI makes beside the book, so only ``status == 'accepted'`` ever lands here."""

    topic_id: str
    name: str
    cloth: str | None
    source: str
    source_detail: str | None


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
    #: The owner's place in the paper, or None when they have not started it (#192).
    reading: ReadingState | None
    #: The year first submitted, from the arXiv id ONLY; None when unsure (never the parser's
    #: ``metadata.year``, which is a stamp date or a year cited in the text). See ``arxiv_year``.
    year: int | None
    arxiv_id: str | None
    #: The primary category in the margin stamp (``cs.CL``), or None.
    arxiv_category: str | None
    thread_count: int
    has_summary: bool
    #: The topic the owner accepted for this paper, or None (unshelved, or only an offer).
    topic: ShelfTopic | None = None


@dataclass(frozen=True, slots=True)
class LinkReference:
    """One bibliography entry of a paper, as ``GET /library/links`` matches against it."""

    #: Zero-based position in ``papers.references_json`` (document order).
    index: int
    #: The entry's text, ``blocks.text`` of its ``reference_entry`` block (may be empty).
    text: str
    #: The arXiv id the parser found in the entry (``references.py``), or None.
    arxiv_id: str | None


@dataclass(frozen=True, slots=True)
class LinkSource:
    """What the library-links matcher needs from one promoted paper: its identity and its
    bibliography. Derived on read; nothing here is stored."""

    paper_id: str
    #: ``metadata.title.value`` of the promoted generation (never the filename), or None.
    title: str | None
    arxiv_id: str | None
    references: tuple[LinkReference, ...]


_LINKS_SQL: Final = """
SELECT po.paper_id, p.metadata, je.key AS ref_index,
       -- A references_json that is not a JSON array is read as "no references" (and logged), never
       -- allowed to fail the whole library: json_each raises on malformed text.
       (json_valid(p.references_json) AND json_type(p.references_json) = 'array') AS refs_ok,
       json_extract(je.value, '$.arxiv_id') AS ref_arxiv, b.text AS ref_text
  FROM paper_owners po
  JOIN paper_promotions pp ON pp.owner_id = po.owner_id AND pp.paper_id = po.paper_id
  JOIN papers p
    ON p.owner_id = pp.owner_id AND p.paper_id = pp.paper_id AND p.generation = pp.generation
  LEFT JOIN json_each(CASE WHEN json_valid(p.references_json)
                            AND json_type(p.references_json) = 'array'
                           THEN p.references_json ELSE '[]' END) je
  LEFT JOIN blocks b
    ON b.owner_id = pp.owner_id AND b.paper_id = pp.paper_id AND b.generation = pp.generation
   AND b.block_id = json_extract(je.value, '$.reference_entry_block_id')
 WHERE po.owner_id = ?
 ORDER BY po.created_at DESC, po.paper_id DESC, je.key
"""

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
         WHERE h.owner_id = po.owner_id AND h.paper_id = po.paper_id) AS highlight_count,
       -- The margin stamp's text (``arXiv:1706.03762v7  [cs.CL]  2 Aug 2023``): the block the
       -- parser cites for the id. blocks' primary key makes this an index lookup per paper.
       (SELECT b.text FROM blocks b
         WHERE b.owner_id = pp.owner_id AND b.paper_id = pp.paper_id
           AND b.generation = pp.generation
           AND b.block_id = json_extract(p.metadata, '$.arxiv_id.source_block_id')) AS stamp_text,
       (SELECT COUNT(*) FROM ai_threads t
         WHERE t.owner_id = po.owner_id AND t.paper_id = po.paper_id) AS thread_count,
       EXISTS (SELECT 1 FROM derivations d
                WHERE d.owner_id = pp.owner_id AND d.paper_id = pp.paper_id
                  AND d.generation = pp.generation
                  AND d.kind = 'paper_summary') AS has_summary,
       rs.last_page AS rs_last_page, rs.furthest_page AS rs_furthest_page, rs.mode AS rs_mode,
       rs.opened_at AS rs_opened_at, rs.updated_at AS rs_updated_at,
       rs.finished_at AS rs_finished_at,
       tp.topic_id AS tp_topic_id, tp.name AS tp_name, tp.cloth AS tp_cloth,
       pt.source AS tp_source, pt.source_detail AS tp_source_detail
  FROM paper_owners po
  LEFT JOIN reading_state rs
         ON rs.owner_id = po.owner_id AND rs.paper_id = po.paper_id
  LEFT JOIN paper_topics pt
         ON pt.owner_id = po.owner_id AND pt.paper_id = po.paper_id AND pt.status = 'accepted'
  LEFT JOIN topics tp
         ON tp.owner_id = pt.owner_id AND tp.topic_id = pt.topic_id
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


def _metadata_object(metadata: Any) -> dict[str, Any]:
    """A stored ``papers.metadata`` JSON text as a dict; ``{}`` for anything malformed (a legacy
    row, a hand-written fixture): the library must list a paper whose metadata it cannot read."""
    if not isinstance(metadata, str):
        return {}
    try:
        data = json.loads(metadata)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _metadata_strings(metadata: Any) -> tuple[str | None, tuple[str, ...]]:
    """``(title, authors)`` from a stored ``papers.metadata`` JSON text ("not found" when
    malformed)."""
    data = _metadata_object(metadata)
    title_field = data.get("title")
    title = title_field.get("value") if isinstance(title_field, dict) else None
    authors = tuple(
        author["value"]
        for author in (data.get("authors") or [])
        if isinstance(author, dict) and isinstance(author.get("value"), str) and author["value"]
    )
    return (title if isinstance(title, str) and title.strip() else None), authors


def _metadata_value(data: dict[str, Any], key: str) -> Any:
    field = data.get(key)
    return field.get("value") if isinstance(field, dict) else None


#: A new-style arXiv id, ``YYMM.NNNN`` or ``YYMM.NNNNN`` (the scheme starts with 0704).
_NEW_STYLE_ARXIV = re.compile(r"^(\d{2})(0[1-9]|1[0-2])\.\d{4,5}(?:v\d+)?$")
#: An old-style id, ``archive/YYMMNNN`` (``hep-th/9901001``, ``math.GT/0309136``); used until 0703.
_OLD_STYLE_ARXIV = re.compile(
    r"^[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?/(\d{2})(0[1-9]|1[0-2])\d{3}(?:v\d+)?$"
)

#: The archives arXiv has (the part before the dot, or the whole category when it has no subject).
#: A closed list on purpose: ``[sic]`` and any other bracketed word in a stamp are not categories.
_ARCHIVES_WITH_SUBJECT: Final = frozenset(
    {
        "cs",
        "stat",
        "math",
        "eess",
        "q-bio",
        "q-fin",
        "econ",
        "physics",
        "astro-ph",
        "cond-mat",
        "nlin",
    }
)
_ARCHIVES_WITHOUT_SUBJECT: Final = frozenset(
    {"hep-ex", "hep-lat", "hep-ph", "hep-th", "gr-qc", "math-ph", "nucl-ex", "nucl-th", "quant-ph"}
)
_CATEGORY = re.compile(r"([a-z]+(?:-[a-z]+)*)(?:\.([A-Za-z]+(?:-[A-Za-z]+)*))?")


def arxiv_year(arxiv_id: str | None) -> int | None:
    """The year an arXiv paper was first submitted, read off its id (``1706.03762`` -> 2017).

    The id's ``YYMM`` is the FIRST submission; the parser's ``metadata.year`` is the stamp's date,
    i.e. the latest version (Attention reads 2023, not 2017), or even a year cited in the text. So
    this is the only source of ``year``: a paper without a recognisable id has NO year (null),
    never a guess (#192). Derived at read time; the parser is untouched.

    Args:
        arxiv_id: An arXiv id, with or without a ``vN`` suffix, or None.

    Returns:
        The four-digit year for a new-style id from 0704 on, or an old-style
        ``archive/YYMMNNN`` id (``hep-th/9901001`` -> 1999); None for anything else.
    """
    if arxiv_id is None:
        return None
    new = _NEW_STYLE_ARXIV.match(arxiv_id)
    if new is not None:
        yy, mm = int(new.group(1)), int(new.group(2))
        return 2000 + yy if (yy, mm) >= (7, 4) else None
    old = _OLD_STYLE_ARXIV.match(arxiv_id)
    if old is not None:
        yy, mm = int(old.group(1)), int(old.group(2))
        if yy >= 91:
            return 1900 + yy
        return 2000 + yy if (yy, mm) <= (7, 3) else None
    return None


def _is_category(text: str) -> bool:
    match = _CATEGORY.fullmatch(text)
    if match is None:
        return False
    archive, subject = match.group(1), match.group(2)
    if subject is None:
        return archive in _ARCHIVES_WITHOUT_SUBJECT or archive == "astro-ph"
    return archive in _ARCHIVES_WITH_SUBJECT


def stamp_category(stamp_text: str | None, arxiv_id: str | None) -> str | None:
    """The primary category in an arXiv margin stamp, only where the stamp puts it.

    The stamp reads ``arXiv:<id>[vN]  [<category>]  <date>``; the bracket must follow the id and
    name a real arXiv category (``cs.CL``, ``stat.ML``, ``q-bio.NC``, ``astro-ph.GA``, ``hep-th``).

    Args:
        stamp_text: The stamp block's text, e.g. ``arXiv:1706.03762v7 [cs.CL] 2 Aug 2023``.
        arxiv_id: The id the parser found in that block.

    Returns:
        ``"cs.CL"`` for that example; None when the id is missing, no bracket follows it, or the
        bracket is not a category (``[sic]``).
    """
    if not stamp_text or not arxiv_id:
        return None
    match = re.search(
        r"arXiv:\s*" + re.escape(arxiv_id) + r"(?:v\d+)?\s*\[([^\]\s]+)\]",
        stamp_text,
        re.IGNORECASE,
    )
    if match is None or not _is_category(match.group(1)):
        return None
    return match.group(1)


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


def category_from(metadata: Any, stamp_text: str | None) -> str | None:
    """The primary arXiv category of a paper from its stored metadata and its margin stamp.

    The same derivation ``LibraryRow.arxiv_category`` uses, for queries that need only the
    category and not the whole library row.

    Args:
        metadata: ``papers.metadata`` (JSON text or parsed), or None.
        stamp_text: The text of the block the parser cites for the arXiv id, or None.

    Returns:
        The category (``cs.CL``), or None.
    """
    value = _metadata_value(_metadata_object(metadata), "arxiv_id")
    return stamp_category(stamp_text, value if isinstance(value, str) and value else None)


def _library_row(row: Row) -> LibraryRow:
    title, authors = _metadata_strings(row["metadata"])
    data = _metadata_object(row["metadata"])
    arxiv_value = _metadata_value(data, "arxiv_id")
    arxiv_id = arxiv_value if isinstance(arxiv_value, str) and arxiv_value else None
    page_count = row["page_count"]
    reading = (
        None
        if row["rs_last_page"] is None
        else reading_state_from({k[3:]: row[k] for k in row if k.startswith("rs_")}, page_count)
    )
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
        reading=reading,
        year=arxiv_year(arxiv_id),
        arxiv_id=arxiv_id,
        arxiv_category=stamp_category(row["stamp_text"], arxiv_id),
        thread_count=int(row["thread_count"]),
        has_summary=bool(row["has_summary"]),
        topic=(
            None
            if row["tp_topic_id"] is None
            else ShelfTopic(
                topic_id=row["tp_topic_id"],
                name=row["tp_name"],
                cloth=row["tp_cloth"],
                source=row["tp_source"],
                source_detail=row["tp_source_detail"],
            )
        ),
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

    def library_link_sources(self, owner: OwnerId) -> list[LinkSource]:
        """Every promoted paper of the owner with its bibliography, in ONE query (newest paper
        first, entries in document order). The input of ``GET /library/links``.

        A paper with no promoted generation (still parsing, failed) is absent: it has no
        references yet and no parsed title to be matched by.

        Args:
            owner: The caller's owner handle.

        Returns:
            One ``LinkSource`` per promoted paper; ``references`` is empty when the parse found
            no bibliography.
        """
        owner_id = self._resolve(owner)
        order: list[str] = []
        meta: dict[str, dict[str, Any]] = {}
        refs: dict[str, list[LinkReference]] = {}
        for row in self._conn.execute(_LINKS_SQL, (owner_id,)):
            paper_id = row["paper_id"]
            if paper_id not in meta:
                if not row["refs_ok"]:
                    _log.warning("references_json of paper %s is not an array; none read", paper_id)
                order.append(paper_id)
                meta[paper_id] = _metadata_object(row["metadata"])
                refs[paper_id] = []
            if row["ref_index"] is not None:
                arxiv = row["ref_arxiv"]
                refs[paper_id].append(
                    LinkReference(
                        index=int(row["ref_index"]),
                        text=row["ref_text"] or "",
                        arxiv_id=arxiv if isinstance(arxiv, str) and arxiv else None,
                    )
                )
        sources: list[LinkSource] = []
        for paper_id in order:
            data = meta[paper_id]
            title_value = _metadata_value(data, "title")
            arxiv_value = _metadata_value(data, "arxiv_id")
            sources.append(
                LinkSource(
                    paper_id=paper_id,
                    title=title_value
                    if isinstance(title_value, str) and title_value.strip()
                    else None,
                    arxiv_id=arxiv_value if isinstance(arxiv_value, str) and arxiv_value else None,
                    references=tuple(refs[paper_id]),
                )
            )
        return sources

    def library_row(self, owner: OwnerId, paper_id: PaperId) -> LibraryRow | None:
        """``list_library``'s row for one paper, or None when it is not this owner's."""
        owner_id = self._resolve(owner)
        row = self._conn.execute(_ROW_SQL + " AND po.paper_id = ?", (owner_id, paper_id)).fetchone()
        return None if row is None else _library_row(row)

    def get_display_name(self, owner: OwnerId) -> str | None:
        """The name the owner chose for their library (the bookplate, the account menu), or None
        until they set one. Never derived from the email (#192).

        Args:
            owner: The caller's owner handle.

        Returns:
            The stored display name, or None.
        """
        owner_id = self._resolve(owner)
        row = self._conn.execute(
            "SELECT display_name FROM users WHERE user_id = ?", (owner_id,)
        ).fetchone()
        return None if row is None else row["display_name"]

    def set_display_name(self, owner: OwnerId, display_name: str) -> str:
        """Stores the owner's display name, trimmed.

        Args:
            owner: The caller's owner handle.
            display_name: 1 to 60 characters once trimmed.

        Returns:
            The name as stored (trimmed).

        Raises:
            ValueError: The trimmed name is empty or longer than 60 characters.
        """
        name = display_name.strip()
        if not 1 <= len(name) <= DISPLAY_NAME_MAX:
            raise ValueError(f"display_name must be 1 to {DISPLAY_NAME_MAX} characters")
        owner_id = self._resolve(owner)
        self._conn.execute("UPDATE users SET display_name = ? WHERE user_id = ?", (name, owner_id))
        return name

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
