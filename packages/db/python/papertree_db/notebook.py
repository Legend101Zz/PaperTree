"""The notebook store: pages, the items placed on them, and ink strokes (v0.2 S5a, #206; 0007).

Owns every SQL statement behind ``routers/notebooks.py``. It follows ``canvas.py``: owner-scoped
through ``_resolve``, client-minted ids, ``version`` + optimistic concurrency, and a
``NotebookRejected`` the route maps to the contract envelope.

Two rules the schema cannot express and this module keeps:

* A quote card holds the full Anchor of its passage (never a bare block id, AGENTS.md section 4),
  and that anchor must be on the page's own paper.
* Ink is opaque here. The blob is the web's ``encodeStroke`` bytes; we walk it once to prove the
  web's ``decodeStroke`` would accept it (version, flags, count, every varint, no trailing bytes),
  and never read a coordinate.

"Dive in" (``create_page(from_message_id=...)``) seeds the page in the same transaction from a
stored assistant answer, so a page never exists half-seeded.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final, Literal

from ._support import Row, client_json, now_iso
from .errors import PaperNotFound
from .ids import OwnerId, PaperId, new_id

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

TEMPLATES: Final = frozenset({"blank", "dot", "lined", "cornell", "derivation"})
ITEM_KINDS: Final = frozenset({"exchange", "text", "sticky", "quote", "shape"})
STROKE_TOOLS: Final = frozenset({"pen", "highlighter"})
STROKE_NIBS: Final = frozenset({"EF", "F", "M"})

#: Mirrors the web's ``MAX_STROKE_POINTS`` (stroke.ts); a count above it is refused.
MAX_STROKE_POINTS: Final = 20_000
#: Bytes of one coordinate's varint at the worst case the encoder can write: a delta between the
#: two coordinate extremes is 2 * 16e6 = 3.2e7 steps, zigzag doubles it to 6.4e7, and 7 payload
#: bits per byte reach 2**28 = 2.68e8 in four bytes (three reach only 2.1e6).
_WORST_COORDINATE_BYTES: Final = 4
#: version + flags + the varint count of 20,000 (above 16,383, so three bytes).
_WORST_HEADER_BYTES: Final = 2 + 3
#: x + y at the worst case, plus the pressure byte.
_WORST_POINT_BYTES: Final = 2 * _WORST_COORDINATE_BYTES + 1
#: One stroke's blob: the encoder's real worst case, 5 + 20,000 * 9 = 180,005 bytes (alternating
#: between the coordinate extremes, with pressure), plus 1 KiB of margin. The earlier "~3.4 bytes
#: per point" is the typical smooth stroke, not the bound, and a cap below the worst case answers
#: 413 to a legal pen-up.
MAX_STROKE_BYTES: Final = _WORST_HEADER_BYTES + MAX_STROKE_POINTS * _WORST_POINT_BYTES + 1024
#: Decoded bytes of one ``add_strokes`` batch, so 200 strokes cannot each be near the cap.
MAX_BATCH_BYTES: Final = 2 * 1024 * 1024
#: The blob layout version the web writes as its first byte (stroke.ts ``FORMAT_VERSION``).
STROKE_FORMAT_VERSION: Final = 1
#: stroke.ts ``FLAG_PRESSURE``: one pressure byte follows each point.
STROKE_FLAG_PRESSURE: Final = 1
#: Search results are a list for a person to scan, not a dump.
SEARCH_LIMIT: Final = 50

_PAGE_COLUMNS: Final = (
    "page_id, paper_id, title, template, source_thread_id, source_message_id, version, "
    "created_at, updated_at"
)
_ITEM_COLUMNS: Final = (
    "item_id, page_id, kind, x, y, w, h, z, body, anchor_json, version, created_at, updated_at"
)
_STROKE_COLUMNS: Final = "stroke_id, page_id, tool, nib, colour, points, created_at"

# "Dive in" layout, in page units (page width 960, apps/web notebook/model/page.ts): the exchange
# across the top, then the trace as quote cards, three to a row.
_MARGIN: Final = 48.0
_EXCHANGE_H: Final = 320.0
_QUOTE_W: Final = 272.0
_QUOTE_H: Final = 140.0
_GAP: Final = 24.0


#: ``(generation, anchor, marker) -> key``: equal keys are "the same passage" (S4a's rule).
PassageKey = Callable[[int, Mapping[str, Any], str], str]


class NotebookRejected(ValueError):
    """A notebook write the store refuses; ``code`` is the contract's error code for the route."""

    def __init__(
        self,
        code: Literal["validation_failed", "not_found", "payload_too_large"],
        detail: str,
    ) -> None:
        """Builds the refusal.

        Args:
            code: The contract error code (422, 404 or 413 once the route maps it).
            detail: A sentence safe to show a person.
        """
        super().__init__(detail)
        self.code: Literal["validation_failed", "not_found", "payload_too_large"] = code
        self.detail = detail


@dataclass(frozen=True, slots=True)
class NotebookStale:
    """A patch lost an optimistic-concurrency race: ``current`` is the stored row (409)."""

    current: Row


def _bad(detail: str) -> NotebookRejected:
    return NotebookRejected("validation_failed", detail)


def _page(row: Row) -> Row:
    return dict(row)


def _item(row: Row) -> Row:
    out = dict(row)
    anchor = out.pop("anchor_json")
    out["anchor"] = None if anchor is None else json.loads(anchor)
    return out


def _require_json_object(body: str) -> None:
    """An exchange or shape ``body`` is the JSON of an object; create AND patch hold to it.

    Search runs ``json_extract`` over exchange bodies, so a stored non-object is not only
    malformed data: it was once able to take every search on the paper down (review of S5a).
    """
    try:
        if not isinstance(json.loads(body), dict):
            raise ValueError
    except ValueError as exc:
        raise _bad("body: an exchange or shape carries a JSON object") from exc


def _read_varint(blob: bytes, at: int) -> tuple[int, int]:
    """One unsigned LEB128 varint at ``at``, as stroke.ts ``decodeStroke`` reads it.

    Returns:
        ``(value, next offset)``.

    Raises:
        NotebookRejected: ``validation_failed`` when the blob ends inside it, or it is longer than
            the 8 bytes ``decodeStroke`` accepts.
    """
    value = 0
    for n in range(8):
        if at >= len(blob):
            raise _bad("points: truncated stroke")
        byte = blob[at]
        at += 1
        value |= (byte & 0x7F) << (7 * n)
        if byte < 0x80:
            return value, at
    raise _bad("points: varint too long")


def check_stroke_blob(blob: bytes) -> None:
    """Refuses a stroke blob that stroke.ts ``decodeStroke`` would refuse.

    The layout is ``[version, flags, varint count]`` then, per point, a zigzag varint x and a
    zigzag varint y (deltas), and one pressure byte when the pressure flag is set. This walks every
    point so a count that lies, a truncated point, junk after the last point, or a blob that
    claims zero points and carries more bytes cannot be stored: the page GET would then hand the
    web a stroke it cannot draw. Coordinates are not interpreted (zigzag deltas are skipped).

    Args:
        blob: The decoded ``points`` bytes.

    Raises:
        NotebookRejected: ``payload_too_large`` over ``MAX_STROKE_BYTES``; ``validation_failed``
            for a truncated blob, a version byte other than 1, unknown flag bits, a point count
            above ``MAX_STROKE_POINTS``, or trailing bytes.
    """
    if len(blob) > MAX_STROKE_BYTES:
        raise NotebookRejected("payload_too_large", "points: the stroke is too large")
    if len(blob) < 2:
        raise _bad("points: truncated stroke")
    if blob[0] != STROKE_FORMAT_VERSION:
        raise _bad(f"points: unknown stroke format version {blob[0]}")
    if blob[1] & ~STROKE_FLAG_PRESSURE:
        raise _bad("points: unknown stroke flags")
    count, at = _read_varint(blob, 2)
    if count > MAX_STROKE_POINTS:
        raise _bad("points: too many points in one stroke")
    for _ in range(count):
        _, at = _read_varint(blob, at)  # x delta
        _, at = _read_varint(blob, at)  # y delta
        if blob[1] & STROKE_FLAG_PRESSURE:
            if at >= len(blob):
                raise _bad("points: truncated stroke")
            at += 1
    if at != len(blob):
        raise _bad("points: trailing bytes after the last point")


def _finite(name: str, value: object, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise _bad(f"{name}: must be a finite number")
    if positive and value <= 0:
        raise _bad(f"{name}: must be greater than 0")
    return float(value)


def _snippet(text: str, needle: str) -> str:
    at = text.lower().find(needle.lower())
    start = max(0, at - 40)
    return ("..." if start else "") + text[start : at + len(needle) + 80].replace("\n", " ")


def _quote_text(anchor: Mapping[str, Any]) -> str:
    """The passage's words from its TextQuoteSelector: a display cache only."""
    for selector in anchor.get("selectors", ()):
        if isinstance(selector, Mapping) and selector.get("type") == "TextQuoteSelector":
            return str(selector.get("exact", ""))
    return ""


class NotebookMixin(_Base):
    """The notebook half of ``PaperTreeDb``: pages, items, strokes, "Dive in" and search.

    Stateless like the other mixins (``__slots__ = ()``); every method takes an ``OwnerId`` and
    filters on it, so another owner's page, item or stroke is simply not found.
    """

    __slots__ = ()

    # ── pages ────────────────────────────────────────────────────────────────────────────

    def create_notebook_page(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        *,
        page_id: str,
        title: str | None = None,
        template: str = "dot",
        from_message_id: str | None = None,
        passage_key: PassageKey | None = None,
    ) -> tuple[Row, list[Row]]:
        """Creates a page, optionally seeded by "Dive in" from an assistant answer.

        Idempotent on ``page_id``: a retry finds its page already stored on this paper and gets it
        back. With ``from_message_id`` the page gets one ``exchange`` item (the call slip: the
        question and the thread's origin anchor; the AI slip: message id, model, content) and one
        ``quote`` item per DISTINCT cited passage, in order of first use, each with the citation's
        stored Anchor and the quoted words as a display cache. "Distinct" is ``passage_key``, the
        same key the explain panel numbers passages by, so quote ``i`` is passage number ``i``.

        Args:
            owner: The caller.
            paper_id: The paper the page belongs to.
            page_id: The client-minted page id.
            title: The page title; defaults to "Untitled page" or "Dive in: <thread title>".
            template: One of the five page templates.
            from_message_id: An assistant message of this paper's threads, to seed from.
            passage_key: Required with ``from_message_id``. ``(generation, anchor, marker)`` ->
                the passage's key; the API passes ``evidence.passage_key`` built on the Anchor's
                BlockSelector. It is injected because the key's rule lives in the API package.

        Returns:
            ``(page, items)``.

        Raises:
            PaperNotFound: the paper is not this owner's.
            NotebookRejected: ``not_found`` for a message that is not this owner's;
                ``validation_failed`` for a message not on this paper or not an assistant message,
                an unknown template, or a ``page_id`` another owner holds.
        """
        owner_id = self._resolve(owner)
        if template not in TEMPLATES:
            raise _bad("template: not one of the five page templates")
        with self.transaction():
            if self.owned_paper(owner, paper_id) is None:
                raise PaperNotFound(paper_id)
            existing = self._one(
                f"SELECT {_PAGE_COLUMNS} FROM notebook_pages WHERE owner_id = ? AND page_id = ?",
                (owner_id, page_id),
            )
            if existing is not None:
                if existing["paper_id"] != paper_id:
                    raise _bad("page_id: already in use")
                return _page(existing), self._items(owner_id, page_id)
            seed = (
                None
                if from_message_id is None
                else self._dive_in_seed(owner_id, paper_id, from_message_id, passage_key)
            )
            now = now_iso()
            thread_id = None if seed is None else seed["thread_id"]
            page_title = title or (
                "Untitled page" if seed is None else f"Dive in: {seed['thread_title']}"[:200]
            )
            try:
                self._conn.execute(
                    "INSERT INTO notebook_pages (page_id, owner_id, paper_id, title, template, "
                    "source_thread_id, source_message_id, version, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,1,?,?)",
                    (page_id, owner_id, paper_id, page_title, template, thread_id,
                     from_message_id, now, now),
                )  # fmt: skip
            except sqlite3.IntegrityError as exc:
                raise _bad("page_id: already in use") from exc
            # Fresh ids: ``item_id`` is a global primary key, so ids derived from the page id's
            # suffix collided across pages and owners (a 500). A retry never reaches here: the
            # page exists, so it returned above with the items it already has.
            # ``z`` carries the seed order: items read back ``ORDER BY z, created_at, item_id`` and
            # random ids no longer sort in insertion order.
            for z, item in enumerate(() if seed is None else seed["items"]):
                self._insert_item(owner_id, page_id, new_id("ni"), {**item, "z": z}, now)
            row = self._one(
                f"SELECT {_PAGE_COLUMNS} FROM notebook_pages WHERE owner_id = ? AND page_id = ?",
                (owner_id, page_id),
            )
            assert row is not None
            return _page(row), self._items(owner_id, page_id)

    def _dive_in_seed(
        self, owner_id: str, paper_id: str, message_id: str, passage_key: PassageKey | None
    ) -> dict[str, Any]:
        if passage_key is None:
            raise ValueError("passage_key is required to seed a page from a message")
        message = self._one(
            "SELECT m.message_id, m.thread_id, m.ordinal, m.role, m.content, t.paper_id, "
            "t.title AS thread_title, t.origin_anchor_json FROM ai_messages m "
            "JOIN ai_threads t ON t.owner_id = m.owner_id AND t.thread_id = m.thread_id "
            "WHERE m.owner_id = ? AND m.message_id = ?",
            (owner_id, message_id),
        )
        if message is None:
            raise NotebookRejected("not_found", "no such message")
        if message["paper_id"] != paper_id:
            raise _bad("from_message_id: the message is not on this paper")
        if message["role"] != "assistant":
            raise _bad("from_message_id: only an assistant answer can be dived into")
        question = self._one(
            "SELECT content FROM ai_messages WHERE owner_id = ? AND thread_id = ? AND role = 'user'"
            " AND ordinal < ? ORDER BY ordinal DESC LIMIT 1",
            (owner_id, message["thread_id"], message["ordinal"]),
        )
        run = self._one(
            "SELECT model FROM ai_runs WHERE owner_id = ? AND message_id = ?",
            (owner_id, message_id),
        )
        origin = message["origin_anchor_json"]
        exchange = {
            "call": {
                "text": "" if question is None else question["content"],
                "origin_anchor": None if origin is None else json.loads(origin),
            },
            "ai": {
                "message_id": message_id,
                "model": None if run is None else run["model"],
                "content": message["content"],
            },
        }
        items: list[dict[str, Any]] = [
            {"kind": "exchange", "x": _MARGIN, "y": _MARGIN, "w": 864.0, "h": _EXCHANGE_H,
             "body": client_json(exchange), "anchor_json": None}
        ]  # fmt: skip
        seen: set[str] = set()
        for cite in self._all(
            "SELECT marker, generation, anchor_json FROM ai_citations "
            "WHERE owner_id = ? AND message_id = ? ORDER BY ordinal",
            (owner_id, message_id),
        ):
            anchor = json.loads(cite["anchor_json"])
            key = passage_key(cite["generation"], anchor, cite["marker"])
            if key in seen:
                continue
            seen.add(key)
            slot = len(seen) - 1
            items.append(
                {"kind": "quote", "x": _MARGIN + (slot % 3) * (_QUOTE_W + _GAP),
                 "y": _MARGIN + _EXCHANGE_H + _GAP + (slot // 3) * (_QUOTE_H + _GAP),
                 "w": _QUOTE_W, "h": _QUOTE_H,
                 "body": _quote_text(anchor),
                 "anchor_json": cite["anchor_json"]}
            )  # fmt: skip
        return {"thread_id": message["thread_id"], "thread_title": message["thread_title"],
                "items": items}  # fmt: skip

    def list_notebook_pages(self, owner: OwnerId, paper_id: PaperId) -> list[Row]:
        """The paper's pages, newest first, each with its ``counts`` -- ONE query, no N+1."""
        owner_id = self._resolve(owner)

        def count(kind: str) -> str:
            return (
                "(SELECT COUNT(*) FROM notebook_items i WHERE i.owner_id = p.owner_id "
                f"AND i.page_id = p.page_id AND i.kind = '{kind}')"
            )

        rows = self._all(
            "SELECT p.page_id, p.title, p.template, p.version, p.updated_at, "
            f"{count('quote')} AS quotes, {count('sticky')} AS stickies, {count('text')} AS text, "
            f"{count('shape')} AS shapes, (SELECT COUNT(*) FROM notebook_strokes s "
            "WHERE s.owner_id = p.owner_id AND s.page_id = p.page_id) AS strokes "
            "FROM notebook_pages p WHERE p.owner_id = ? AND p.paper_id = ? "
            "ORDER BY p.updated_at DESC, p.page_id DESC",
            (owner_id, paper_id),
        )
        for row in rows:
            row["counts"] = {
                k: row.pop(k) for k in ("quotes", "stickies", "text", "shapes", "strokes")
            }
        return rows

    def get_notebook_page(
        self, owner: OwnerId, page_id: str
    ) -> tuple[Row, list[Row], list[Row]] | None:
        """``(page, items, strokes)``, or None when the page is not this owner's."""
        owner_id = self._resolve(owner)
        page = self._page_row(owner_id, page_id)
        if page is None:
            return None
        strokes = self._all(
            f"SELECT {_STROKE_COLUMNS} FROM notebook_strokes WHERE owner_id = ? AND page_id = ? "
            "ORDER BY created_at, stroke_id",
            (owner_id, page_id),
        )
        return _page(page), self._items(owner_id, page_id), strokes

    def patch_notebook_page(
        self, owner: OwnerId, page_id: str, version: int, fields: Mapping[str, Any]
    ) -> Row | NotebookStale | None:
        """Changes ``title`` and/or ``template`` if ``version`` is the stored one.

        Returns:
            The page at ``version + 1``; ``NotebookStale(current)`` for a stale ``version``;
            None when the page is not this owner's.
        """
        owner_id = self._resolve(owner)
        sets: list[str] = []
        params: list[Any] = []
        if "title" in fields:
            if not isinstance(fields["title"], str) or not fields["title"].strip():
                raise _bad("title: must be a non-empty string")
            sets.append("title = ?")
            params.append(fields["title"])
        if "template" in fields:
            if fields["template"] not in TEMPLATES:
                raise _bad("template: not one of the five page templates")
            sets.append("template = ?")
            params.append(fields["template"])
        return self._versioned_update("notebook_pages", "page_id", owner_id, page_id, version,
                                      sets, params, None)  # fmt: skip

    def delete_notebook_page(self, owner: OwnerId, page_id: str) -> int:
        """Deletes a page; its items and strokes cascade. Returns rows deleted (0: not found).

        REFUSED while a board card shows the page (S6a, #211): a notebook card's pointer is
        required (``canvas_nodes`` CHECK), so deleting under it would leave a card that points
        at nothing. The person removes the card first, then the page.

        Raises:
            NotebookRejected: ``validation_failed`` when a notebook card on a board points here.
        """
        owner_id = self._resolve(owner)
        with self.transaction():
            on_board = self._one(
                "SELECT 1 AS ok FROM canvas_nodes WHERE owner_id = ? AND kind = 'notebook' "
                "AND source_page_id = ?",
                (owner_id, page_id),
            )
            if on_board is not None:
                raise NotebookRejected(
                    "validation_failed",
                    "This page is on the board. Remove its card from the board first.",
                )
            return self._conn.execute(
                "DELETE FROM notebook_pages WHERE owner_id = ? AND page_id = ?", (owner_id, page_id)
            ).rowcount

    # ── items ────────────────────────────────────────────────────────────────────────────

    def create_notebook_item(self, owner: OwnerId, page_id: str, item: Mapping[str, Any]) -> Row:
        """Adds an item to a page. Idempotent on ``item_id`` within the page.

        Args:
            owner: The caller.
            page_id: The page to add to.
            item: ``item_id``, ``kind``, ``x``, ``y``, ``w``, ``h``, optional ``z`` and ``body``,
                and for a ``quote`` the full ``anchor`` (on this page's paper).

        Raises:
            NotebookRejected: ``not_found`` for an unknown page; ``validation_failed`` for a quote
                without an Anchor or with one from another paper, an Anchor on a non-quote, a
                non-finite number, or an ``item_id`` held elsewhere.
        """
        owner_id = self._resolve(owner)
        item_id, kind = item.get("item_id"), item.get("kind")
        if not isinstance(item_id, str) or not item_id:
            raise _bad("item_id: required")
        if kind not in ITEM_KINDS:
            raise _bad("kind: must be exchange, text, sticky, quote or shape")
        body = item.get("body", "")
        if not isinstance(body, str):
            raise _bad("body: must be a string")
        values: dict[str, Any] = {
            "kind": kind,
            "x": _finite("x", item.get("x")),
            "y": _finite("y", item.get("y")),
            "w": _finite("w", item.get("w"), positive=True),
            "h": _finite("h", item.get("h"), positive=True),
            "z": int(item.get("z", 0)),
            "body": body,
            "anchor_json": None,
        }
        if kind in ("exchange", "shape"):
            _require_json_object(body)
        with self.transaction():
            page = self._page_row(owner_id, page_id)
            if page is None:
                raise NotebookRejected("not_found", "no such page")
            values["anchor_json"] = self._checked_anchor(kind, item.get("anchor"), page["paper_id"])
            existing = self._one(
                f"SELECT {_ITEM_COLUMNS} FROM notebook_items WHERE owner_id = ? AND item_id = ?",
                (owner_id, item_id),
            )
            if existing is not None:
                if existing["page_id"] == page_id:
                    return _item(existing)
                raise _bad("item_id: already in use")
            try:
                self._insert_item(owner_id, page_id, item_id, values, now_iso())
            except sqlite3.IntegrityError as exc:
                raise _bad("item_id: already in use") from exc
            row = self._one(
                f"SELECT {_ITEM_COLUMNS} FROM notebook_items WHERE owner_id = ? AND item_id = ?",
                (owner_id, item_id),
            )
            self._touch(owner_id, page_id)
        assert row is not None
        return _item(row)

    def patch_notebook_item(
        self, owner: OwnerId, page_id: str, item_id: str, version: int, fields: Mapping[str, Any]
    ) -> Row | NotebookStale | None:
        """Changes the present ``x y w h z body`` of an item if ``version`` is the stored one.

        Returns:
            The item at ``version + 1``; ``NotebookStale(current)``; None when not found.

        Raises:
            NotebookRejected: ``validation_failed`` for a non-finite number, a non-string
                ``body``, or an exchange or shape ``body`` that is not a JSON object.
        """
        owner_id = self._resolve(owner)
        sets: list[str] = []
        params: list[Any] = []
        for name in ("x", "y", "w", "h"):
            if name in fields:
                sets.append(f"{name} = ?")
                params.append(_finite(name, fields[name], positive=name in ("w", "h")))
        if "z" in fields:
            sets.append("z = ?")
            params.append(int(fields["z"]))
        if "body" in fields:
            if not isinstance(fields["body"], str):
                raise _bad("body: must be a string")
            stored = self._one(
                "SELECT kind FROM notebook_items WHERE owner_id = ? AND page_id = ? "
                "AND item_id = ?",
                (owner_id, page_id, item_id),
            )
            if stored is None:
                return None
            if stored["kind"] in ("exchange", "shape"):
                _require_json_object(fields["body"])
            sets.append("body = ?")
            params.append(fields["body"])
        result = self._versioned_update("notebook_items", "item_id", owner_id, item_id, version,
                                        sets, params, page_id)  # fmt: skip
        if isinstance(result, NotebookStale):
            return NotebookStale(_item(result.current))
        return None if result is None else _item(result)

    def delete_notebook_item(self, owner: OwnerId, page_id: str, item_id: str) -> int:
        """Deletes an item. Returns rows deleted (0: not found)."""
        owner_id = self._resolve(owner)
        with self.transaction():
            n = self._conn.execute(
                "DELETE FROM notebook_items WHERE owner_id = ? AND page_id = ? AND item_id = ?",
                (owner_id, page_id, item_id),
            ).rowcount
            if n:
                self._touch(owner_id, page_id)
            return n

    # ── strokes ──────────────────────────────────────────────────────────────────────────

    def add_notebook_strokes(
        self, owner: OwnerId, page_id: str, strokes: Sequence[Mapping[str, Any]]
    ) -> int:
        """Stores a pen-up batch of strokes, all or none. Idempotent on ``stroke_id``.

        Args:
            owner: The caller.
            page_id: The page they were drawn on.
            strokes: ``stroke_id``, ``tool``, ``nib``, ``colour`` and ``points`` (bytes).

        Returns:
            How many strokes were new.

        Raises:
            NotebookRejected: ``not_found`` for an unknown page; ``payload_too_large`` over the
                per-stroke or per-batch byte cap; ``validation_failed`` for a bad tool, nib or
                blob header, or a ``stroke_id`` held elsewhere.
        """
        owner_id = self._resolve(owner)
        total = 0
        for stroke in strokes:
            if stroke.get("tool") not in STROKE_TOOLS or stroke.get("nib") not in STROKE_NIBS:
                raise _bad("tool or nib: not a known pen, highlighter or nib")
            blob = stroke["points"]
            check_stroke_blob(blob)
            total += len(blob)
        if total > MAX_BATCH_BYTES:
            raise NotebookRejected("payload_too_large", "strokes: the batch is too large")
        added = 0
        with self.transaction():
            if self._page_row(owner_id, page_id) is None:
                raise NotebookRejected("not_found", "no such page")
            now = now_iso()
            for stroke in strokes:
                found = self._one(
                    "SELECT page_id FROM notebook_strokes WHERE owner_id = ? AND stroke_id = ?",
                    (owner_id, stroke["stroke_id"]),
                )
                if found is not None:
                    if found["page_id"] != page_id:
                        raise _bad("stroke_id: already in use")
                    continue
                try:
                    self._conn.execute(
                        "INSERT INTO notebook_strokes (stroke_id, owner_id, page_id, tool, nib, "
                        "colour, points, created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (stroke["stroke_id"], owner_id, page_id, stroke["tool"], stroke["nib"],
                         stroke["colour"], stroke["points"], now),
                    )  # fmt: skip
                except sqlite3.IntegrityError as exc:
                    raise _bad("stroke_id: already in use") from exc
                added += 1
            if added:
                self._touch(owner_id, page_id)
        return added

    def delete_notebook_stroke(self, owner: OwnerId, page_id: str, stroke_id: str) -> int:
        """The eraser: deletes one stroke. Returns rows deleted (0: not found)."""
        owner_id = self._resolve(owner)
        with self.transaction():
            n = self._conn.execute(
                "DELETE FROM notebook_strokes WHERE owner_id = ? AND page_id = ? AND stroke_id = ?",
                (owner_id, page_id, stroke_id),
            ).rowcount
            if n:
                self._touch(owner_id, page_id)
            return n

    # ── search ───────────────────────────────────────────────────────────────────────────

    def search_notebook(self, owner: OwnerId, paper_id: PaperId, query: str) -> list[Row]:
        """Hits for ``query`` in typed text, sticky text, quote text and the AI slip's words.

        Never ink: a stroke has no text. Case-insensitive substring match (``LIKE`` with the
        wildcards escaped), at most ``SEARCH_LIMIT`` hits, newest page first.

        Returns:
            Rows ``page_id``, ``page_title``, ``item_id``, ``kind``, ``snippet``.
        """
        owner_id = self._resolve(owner)
        needle = query.strip()
        if not needle:
            raise _bad("q: required")
        pattern = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        # json_valid() first, inside the CASE: a stored exchange body that is not JSON must make
        # that ONE row unsearchable, never turn every search on the paper into a 500.
        ai_text = "CASE WHEN json_valid(i.body) THEN json_extract(i.body, '$.ai.content') END"
        call_text = "CASE WHEN json_valid(i.body) THEN json_extract(i.body, '$.call.text') END"
        sql_text = f"CASE i.kind WHEN 'exchange' THEN {ai_text} ELSE i.body END"
        rows = self._all(
            "SELECT p.page_id, p.title AS page_title, i.item_id, i.kind, "
            f"{sql_text} AS text, CASE i.kind WHEN 'exchange' THEN {call_text} END AS call_text "
            "FROM notebook_items i JOIN notebook_pages p "
            "ON p.owner_id = i.owner_id AND p.page_id = i.page_id "
            "WHERE i.owner_id = ? AND p.paper_id = ? "
            "AND i.kind IN ('text','sticky','quote','exchange') "
            f"AND ({sql_text} LIKE ? ESCAPE '\\' "
            f"OR (i.kind = 'exchange' AND {call_text} LIKE ? ESCAPE '\\')) "
            "ORDER BY p.updated_at DESC, p.page_id, i.z, i.item_id LIMIT ?",
            (owner_id, paper_id, pattern, pattern, SEARCH_LIMIT),
        )
        hits: list[Row] = []
        for row in rows:
            text = str(row["text"] or "")
            if needle.lower() not in text.lower():
                text = str(row["call_text"] or text)
            hits.append({k: row[k] for k in ("page_id", "page_title", "item_id", "kind")}
                        | {"snippet": _snippet(text, needle)})  # fmt: skip
        return hits

    # ── internals ────────────────────────────────────────────────────────────────────────

    def _page_row(self, owner_id: str, page_id: str) -> Row | None:
        return self._one(
            f"SELECT {_PAGE_COLUMNS} FROM notebook_pages WHERE owner_id = ? AND page_id = ?",
            (owner_id, page_id),
        )

    def _items(self, owner_id: str, page_id: str) -> list[Row]:
        return [
            _item(r)
            for r in self._all(
                f"SELECT {_ITEM_COLUMNS} FROM notebook_items WHERE owner_id = ? AND page_id = ? "
                "ORDER BY z, created_at, item_id",
                (owner_id, page_id),
            )
        ]

    def _touch(self, owner_id: str, page_id: str) -> None:
        """Bumps the page's ``updated_at`` (not ``version``: that is for title/template edits)."""
        self._conn.execute(
            "UPDATE notebook_pages SET updated_at = ? WHERE owner_id = ? AND page_id = ?",
            (now_iso(), owner_id, page_id),
        )

    def _insert_item(
        self, owner_id: str, page_id: str, item_id: str, v: Mapping[str, Any], now: str
    ) -> None:
        self._conn.execute(
            "INSERT INTO notebook_items (item_id, owner_id, page_id, kind, x, y, w, h, z, body, "
            "anchor_json, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
            (item_id, owner_id, page_id, v["kind"], v["x"], v["y"], v["w"], v["h"],
             v.get("z", 0), v["body"], v["anchor_json"], now, now),
        )  # fmt: skip

    @staticmethod
    def _checked_anchor(kind: str, anchor: object, paper_id: str) -> str | None:
        if kind != "quote":
            if anchor is not None:
                raise _bad("anchor: only a quote carries one")
            return None
        if not isinstance(anchor, Mapping):
            raise _bad("anchor: required for a quote")
        doc = anchor.get("doc")
        if not isinstance(doc, Mapping) or doc.get("paperId") != paper_id:
            raise _bad("anchor: the anchor is not on this page's paper")
        try:
            return client_json({k: v for k, v in anchor.items() if k != "resolution"})
        except (TypeError, ValueError) as exc:
            raise _bad("anchor: not valid JSON") from exc

    def _versioned_update(
        self,
        table: str,
        id_column: str,
        owner_id: str,
        row_id: str,
        version: int,
        sets: list[str],
        params: list[Any],
        page_id: str | None,
    ) -> Row | NotebookStale | None:
        """One optimistic-concurrency UPDATE for a page (``page_id`` None) or an item.

        ``table`` / ``id_column`` are fixed literals from the two callers above, never input.
        """
        columns = _PAGE_COLUMNS if page_id is None else _ITEM_COLUMNS
        scope = "" if page_id is None else " AND page_id = ?"
        scope_params: tuple[Any, ...] = () if page_id is None else (page_id,)
        with self.transaction():
            current = self._one(
                f"SELECT {columns} FROM {table} WHERE owner_id = ? AND {id_column} = ?{scope}",
                (owner_id, row_id, *scope_params),
            )
            if current is None:
                return None
            if current["version"] != version:
                return NotebookStale(current)
            sets = [*sets, "version = version + 1", "updated_at = ?"]
            self._conn.execute(
                f"UPDATE {table} SET {', '.join(sets)} "
                f"WHERE owner_id = ? AND {id_column} = ?{scope} AND version = ?",
                (*params, now_iso(), owner_id, row_id, *scope_params, version),
            )
            if page_id is not None:
                self._touch(owner_id, page_id)
            row = self._one(
                f"SELECT {columns} FROM {table} WHERE owner_id = ? AND {id_column} = ?{scope}",
                (owner_id, row_id, *scope_params),
            )
        assert row is not None
        return row
