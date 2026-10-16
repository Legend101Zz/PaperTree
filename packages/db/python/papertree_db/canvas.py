"""The per-paper canvas: boards, nodes and edges as rows (contracts.md §1.1, §2.7; 0005 §4).

S7 OWNS THIS MODULE. S0 commits it as STUBS so the routes can be written against ``db.<method>``
first; ``tests/test_contract_signatures.py`` pins the signatures. contracts.md §1.1 names the
methods and the ``NodeRow | StaleVersion`` result of ``patch_node``; the remaining parameter types
and the row dataclasses are S0's reading of §2.7 and may be changed by S7 before the first caller.

The rule the schema already enforces and these methods must keep: ``get_board`` NEVER writes (a
board exists only after an explicit send), and ``create_node`` creates the board inside the same
transaction as the first node.
"""

from __future__ import annotations

import json
import math
import sqlite3
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Final, Literal

from ._support import Row, client_json, now_iso
from .errors import PaperNotFound
from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object


@dataclass(frozen=True, slots=True)
class BoardRow:
    board_id: str
    paper_id: str | None
    title: str
    viewport: Mapping[str, float] | None
    created_at: str
    updated_at: str


@dataclass(frozen=True, slots=True)
class NodeRow:
    node_id: str
    board_id: str
    kind: str
    group_id: str | None
    x: float
    y: float
    w: float
    h: float
    z: int
    title: str | None
    body: str
    source_anchor: Mapping[str, Any] | None
    source_message_id: str | None
    version: int
    created_at: str
    updated_at: str
    #: Notebook card -> the notebook page it shows (0008; plain TEXT, validated in Python).
    source_page_id: str | None = None
    #: Diagram card -> the diagram it shows (0008; validated once diagrams exist).
    source_diagram_id: str | None = None


@dataclass(frozen=True, slots=True)
class StaleVersion:
    """``patch_node`` lost an optimistic-concurrency race: ``current`` is the stored node (409)."""

    current: NodeRow


@dataclass(frozen=True, slots=True)
class EdgeRow:
    edge_id: str
    board_id: str
    from_node_id: str
    to_node_id: str
    kind: str
    label: str | None
    created_at: str
    #: The pins this thread was drawn between (0008). None on a v0.1 edge or a keyboard link.
    from_port: str | None = None
    to_port: str | None = None


@dataclass(frozen=True, slots=True)
class NotebookCounts:
    """What a notebook card says about its page ("4 quotes · 1 sticky"), counted on read."""

    quotes: int = 0
    stickies: int = 0
    text: int = 0
    shapes: int = 0
    strokes: int = 0


@dataclass(frozen=True, slots=True)
class BoardSnapshot:
    """``GET /papers/{id}/board``: ``board`` is None until the first send; then nodes and edges.

    ``notebook_counts`` maps the ``node_id`` of every notebook card to its page's counts.
    """

    board: BoardRow | None
    nodes: tuple[NodeRow, ...]
    edges: tuple[EdgeRow, ...]
    notebook_counts: Mapping[str, NotebookCounts] = field(default_factory=dict)


#: "frame" on the design's board IS the ``group`` kind on the wire (dashed outline, paper tag in
#: the UI). A frame is created empty with a title, w and h; moving one moves nothing server-side,
#: because every child carries its own x/y and the client moves them.
NODE_KINDS: Final = frozenset(
    {"excerpt", "explanation", "note", "group", "question", "notebook", "diagram"}
)
OUT_PORTS: Final = frozenset({"claim_out", "answer_out"})
IN_PORTS: Final = frozenset({"evidence_in", "question_in"})


@dataclass(frozen=True, slots=True)
class Pins:
    """The pins one card kind offers: brass out-pins and open in-pins (DESIGN.md section 5)."""

    out: frozenset[str] = frozenset()
    into: frozenset[str] = frozenset()


#: Which card kind offers which pins (frame 06, DESIGN.md section 5). The one table the API
#: checks a threaded edge against; a ``group`` (frame) offers none. An edge without ports is
#: always legal (keyboard linking, and every v0.1 edge).
#:   claim_out (brass dot): passage, note, explanation, notebook, diagram
#:   answer_out (brass diamond): explanation
#:   evidence_in (ring): explanation, note, question, notebook, diagram
#:   question_in (diamond): question, explanation
PIN_TABLE: Final[Mapping[str, Pins]] = {
    "excerpt": Pins(out=frozenset({"claim_out"})),
    "note": Pins(out=frozenset({"claim_out"}), into=frozenset({"evidence_in"})),
    "explanation": Pins(
        out=frozenset({"claim_out", "answer_out"}),
        into=frozenset({"evidence_in", "question_in"}),
    ),
    "question": Pins(into=frozenset({"evidence_in", "question_in"})),
    "notebook": Pins(out=frozenset({"claim_out"}), into=frozenset({"evidence_in"})),
    "diagram": Pins(out=frozenset({"claim_out"}), into=frozenset({"evidence_in"})),
    "group": Pins(),
}
PIN_REFUSED: Final = "that pin does not take that thread"
_KIND_WITH_SOURCE_PAGE: Final = "notebook"
_KIND_WITH_SOURCE_DIAGRAM: Final = "diagram"
EDGE_KINDS: Final = frozenset(
    {"supports", "contradicts", "derives_from", "answers", "compares", "references", "relates"}
)
_NODE_PATCHABLE: Final = (
    "x", "y", "w", "h", "z", "title", "body", "group_id", "source_page_id", "source_diagram_id"
)  # fmt: skip
_NODE_COLUMNS: Final = (
    "node_id, board_id, kind, group_id, x, y, w, h, z, title, body, source_anchor_json, "
    "source_message_id, version, created_at, updated_at, source_page_id, source_diagram_id"
)


class CanvasRejected(ValueError):
    """A canvas write the store refuses before (or instead of) writing.

    ``code`` is the contract's error code (``validation_failed`` -> 422, ``not_found`` -> 404), so
    the route maps it without re-deriving why; ``detail`` is a sentence safe to show.
    """

    def __init__(self, code: Literal["validation_failed", "not_found"], detail: str) -> None:
        super().__init__(detail)
        self.code: Literal["validation_failed", "not_found"] = code
        self.detail = detail


def _bad(detail: str) -> CanvasRejected:
    return CanvasRejected("validation_failed", detail)


def _finite(name: str, value: object, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise _bad(f"{name}: must be a finite number")
    if positive and value <= 0:
        raise _bad(f"{name}: must be greater than 0")
    return float(value)


def check_ports(from_kind: str, to_kind: str, from_port: object, to_port: object) -> None:
    """Refuses a thread whose pins the two cards do not offer (``PIN_TABLE``).

    A missing port is fine (keyboard link, v0.1 edge); each given port must be a real pin the
    card on that end offers.

    Args:
        from_kind: Kind of the source card.
        to_kind: Kind of the target card.
        from_port: The out-pin the thread leaves from, or None.
        to_port: The in-pin the thread arrives at, or None.

    Raises:
        CanvasRejected: ``validation_failed`` - "that pin does not take that thread".
    """
    if from_port is not None and (
        not isinstance(from_port, str) or from_port not in PIN_TABLE.get(from_kind, Pins()).out
    ):
        raise _bad(PIN_REFUSED)
    if to_port is not None and (
        not isinstance(to_port, str) or to_port not in PIN_TABLE.get(to_kind, Pins()).into
    ):
        raise _bad(PIN_REFUSED)


def _source_ref(name: str, value: object, kind: object, owner_kind: str) -> str | None:
    """A card's pointer to the thing it shows: required (a non-empty string) on its own kind,
    refused on every other, so a stray id cannot ride on a note."""
    if kind != owner_kind:
        if value is not None:
            raise _bad(f"{name}: only a {owner_kind} card carries one")
        return None
    if not isinstance(value, str) or not value:
        raise _bad(f"{name}: required for a {owner_kind} card")
    return value


def _node_row(row: Row) -> NodeRow:
    anchor = row["source_anchor_json"]
    return NodeRow(
        node_id=row["node_id"],
        board_id=row["board_id"],
        kind=row["kind"],
        group_id=row["group_id"],
        x=row["x"],
        y=row["y"],
        w=row["w"],
        h=row["h"],
        z=row["z"],
        title=row["title"],
        body=row["body"],
        source_anchor=None if anchor is None else json.loads(anchor),
        source_message_id=row["source_message_id"],
        version=row["version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        source_page_id=row["source_page_id"],
        source_diagram_id=row["source_diagram_id"],
    )


def _board_row(row: Row) -> BoardRow:
    viewport = row["viewport_json"]
    return BoardRow(
        board_id=row["board_id"],
        paper_id=row["paper_id"],
        title=row["title"],
        viewport=None if viewport is None else json.loads(viewport),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _edge_row(row: Row) -> EdgeRow:
    return EdgeRow(
        edge_id=row["edge_id"],
        board_id=row["board_id"],
        from_node_id=row["from_node_id"],
        to_node_id=row["to_node_id"],
        kind=row["kind"],
        label=row["label"],
        created_at=row["created_at"],
        from_port=row["from_port"],
        to_port=row["to_port"],
    )


_BOARD_COLUMNS: Final = "board_id, paper_id, title, viewport_json, created_at, updated_at"
_EDGE_COLUMNS: Final = (
    "edge_id, board_id, from_node_id, to_node_id, kind, label, created_at, from_port, to_port"
)


class CanvasMixin(_Base):
    __slots__ = ()

    def get_board(self, owner: OwnerId, paper_id: PaperId) -> BoardSnapshot:
        """The paper's board with its nodes and edges, or ``board=None`` and nothing else.

        NEVER writes: a board exists only after an explicit send (``create_node``). Three plain
        SELECTs, all owner-scoped; a paper with no board (or one the owner does not have) is the
        empty snapshot, and the route decides whether the paper itself is a 404.
        """
        owner_id = self._resolve(owner)
        board = self._one(
            f"SELECT {_BOARD_COLUMNS} FROM canvas_boards WHERE owner_id = ? AND paper_id = ?",
            (owner_id, paper_id),
        )
        if board is None:
            return BoardSnapshot(None, (), ())
        board_id = board["board_id"]
        nodes = self._all(
            f"SELECT {_NODE_COLUMNS} FROM canvas_nodes WHERE owner_id = ? AND board_id = ? "
            "ORDER BY z, created_at, node_id",
            (owner_id, board_id),
        )
        edges = self._all(
            f"SELECT {_EDGE_COLUMNS} FROM canvas_edges WHERE owner_id = ? AND board_id = ? "
            "ORDER BY created_at, edge_id",
            (owner_id, board_id),
        )
        node_rows = tuple(_node_row(r) for r in nodes)
        return BoardSnapshot(
            _board_row(board),
            node_rows,
            tuple(_edge_row(r) for r in edges),
            self._notebook_counts(owner_id, node_rows),
        )

    def notebook_counts(
        self, owner: OwnerId, nodes: tuple[NodeRow, ...]
    ) -> dict[str, NotebookCounts]:
        """Counts for the notebook cards among ``nodes`` (what a single patched or created card
        needs; ``get_board`` already includes them for the whole board)."""
        return self._notebook_counts(self._resolve(owner), nodes)

    def _table_exists(self, name: str) -> bool:
        return (
            self._one(
                "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
            )
            is not None
        )

    def _notebook_counts(
        self, owner_id: str, nodes: tuple[NodeRow, ...]
    ) -> dict[str, NotebookCounts]:
        """Counts for every notebook card in ONE grouped query (no query per card).

        Migration 0007 (the notebook) may not be applied yet, and a page may have been deleted
        under its card: both read as zero counts, never an error.
        """
        cards = [n for n in nodes if n.kind == "notebook" and n.source_page_id is not None]
        if not cards:
            return {}
        found: dict[str, dict[str, int]] = {}
        if self._table_exists("notebook_items") and self._table_exists("notebook_strokes"):
            pages = sorted({str(c.source_page_id) for c in cards})
            marks = ", ".join("?" for _ in pages)
            rows = self._all(
                f"SELECT page_id, kind, COUNT(*) AS n FROM notebook_items "  # noqa: S608
                f"WHERE owner_id = ? AND page_id IN ({marks}) GROUP BY page_id, kind "
                "UNION ALL "
                f"SELECT page_id, 'stroke', COUNT(*) FROM notebook_strokes "
                f"WHERE owner_id = ? AND page_id IN ({marks}) GROUP BY page_id",
                (owner_id, *pages, owner_id, *pages),
            )
            for r in rows:
                found.setdefault(r["page_id"], {})[r["kind"]] = r["n"]
        out: dict[str, NotebookCounts] = {}
        for card in cards:
            by_kind = found.get(str(card.source_page_id), {})
            out[card.node_id] = NotebookCounts(
                quotes=by_kind.get("quote", 0),
                stickies=by_kind.get("sticky", 0),
                text=by_kind.get("text", 0),
                shapes=by_kind.get("shape", 0),
                strokes=by_kind.get("stroke", 0),
            )
        return out

    def _check_source_page(self, owner_id: str, paper_id: str, page_id: str) -> None:
        """404 unless the page is this owner's AND on this paper (one answer for both, so a
        stranger's page id is indistinguishable from a missing one). Skipped while 0007 is
        absent."""
        if not self._table_exists("notebook_pages"):
            return
        found = self._one(
            "SELECT 1 AS ok FROM notebook_pages WHERE owner_id = ? AND paper_id = ? "
            "AND page_id = ?",
            (owner_id, paper_id, page_id),
        )
        if found is None:
            raise CanvasRejected("not_found", "no such notebook page on this paper")

    def create_node(self, owner: OwnerId, paper_id: PaperId, node: Mapping[str, Any]) -> NodeRow:
        """Adds a node, creating the paper's board in the SAME transaction on the first one.

        IDEMPOTENT ON ``node_id`` (client-minted): a retried send finds its node already stored on
        this owner's board and gets that row back, so a flaky network cannot double a node.
        Raises :class:`PaperNotFound`, or :class:`CanvasRejected` (``validation_failed``) for an
        excerpt without an anchor on THIS paper, an explanation whose message is not an answer in
        a thread of this paper, a ``group_id`` that is not a group node of this board, or a
        number that is not finite.
        """
        owner_id = self._resolve(owner)
        kind = node.get("kind")
        if kind not in NODE_KINDS:
            raise _bad("kind: not one of the seven card kinds")
        node_id = node.get("node_id")
        if not isinstance(node_id, str) or not node_id:
            raise _bad("node_id: required")
        x = _finite("x", node.get("x"))
        y = _finite("y", node.get("y"))
        w = _finite("w", node.get("w"), positive=True)
        h = _finite("h", node.get("h"), positive=True)
        z = node.get("z", 0)
        title = node.get("title")
        body = node.get("body", "")
        if title is not None and not isinstance(title, str):
            raise _bad("title: must be a string or null")
        if not isinstance(body, str):
            raise _bad("body: must be a string")
        anchor = node.get("source_anchor")
        message_id = node.get("source_message_id")
        anchor_json: str | None = None
        if kind == "excerpt":
            if not isinstance(anchor, Mapping):
                raise _bad("source_anchor: required for an excerpt")
            doc = anchor.get("doc")
            if not isinstance(doc, Mapping) or doc.get("paperId") != paper_id:
                raise _bad("source_anchor: the anchor is not on this paper")
            try:
                anchor_json = client_json({k: v for k, v in anchor.items() if k != "resolution"})
            except (TypeError, ValueError) as exc:
                raise _bad("source_anchor: not valid JSON") from exc
        elif anchor is not None:
            raise _bad("source_anchor: only an excerpt carries one")
        if kind == "explanation":
            if not isinstance(message_id, str) or not message_id:
                raise _bad("source_message_id: required for an explanation")
        elif message_id is not None and kind != "question":
            raise _bad("source_message_id: only an explanation or a question carries one")
        elif message_id is not None and not isinstance(message_id, str):
            raise _bad("source_message_id: must be a string")
        page_id = _source_ref("source_page_id", node.get("source_page_id"), kind, "notebook")
        diagram_id = _source_ref(
            "source_diagram_id", node.get("source_diagram_id"), kind, "diagram"
        )
        group_id = node.get("group_id")

        with self.transaction():
            if (
                self._one(
                    "SELECT 1 AS ok FROM paper_owners WHERE owner_id = ? AND paper_id = ?",
                    (owner_id, paper_id),
                )
                is None
            ):
                raise PaperNotFound(paper_id)
            board = self._one(
                "SELECT board_id FROM canvas_boards WHERE owner_id = ? AND paper_id = ?",
                (owner_id, paper_id),
            )
            existing = self._one(
                f"SELECT {_NODE_COLUMNS} FROM canvas_nodes WHERE owner_id = ? AND node_id = ?",
                (owner_id, node_id),
            )
            if existing is not None:
                if board is not None and existing["board_id"] == board["board_id"]:
                    return _node_row(existing)
                raise _bad("node_id: already in use")
            if message_id is not None:
                assert isinstance(message_id, str)
                role = "assistant" if kind == "explanation" else "user"
                known = self._one(
                    "SELECT 1 AS ok FROM ai_messages m JOIN ai_threads t "
                    "ON t.owner_id = m.owner_id AND t.thread_id = m.thread_id "
                    "WHERE m.owner_id = ? AND m.message_id = ? AND t.paper_id = ? "
                    "AND m.role = ?",
                    (owner_id, message_id, paper_id, role),
                )
                if known is None:
                    what = "answer" if kind == "explanation" else "question"
                    raise _bad(f"source_message_id: no such {what} on this paper")
            if page_id is not None:
                self._check_source_page(owner_id, paper_id, page_id)
            now = now_iso()
            if board is None:
                board_id = "brd_" + uuid.uuid4().hex
                self._conn.execute(
                    "INSERT INTO canvas_boards (board_id, owner_id, paper_id, title, "
                    "viewport_json, created_at, updated_at) VALUES (?,?,?,?,NULL,?,?)",
                    (board_id, owner_id, paper_id, "Canvas", now, now),
                )
            else:
                board_id = board["board_id"]
            if group_id is not None:
                self._check_group(owner_id, board_id, node_id, kind, group_id)
            try:
                self._conn.execute(
                    "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, group_id, x, y, "
                    "w, h, z, title, body, source_anchor_json, source_message_id, version, "
                    "created_at, updated_at, source_page_id, source_diagram_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)",
                    (
                        node_id, owner_id, board_id, kind, group_id, x, y, w, h, int(z), title,
                        body, anchor_json, message_id, now, now, page_id, diagram_id,
                    ),
                )  # fmt: skip
            except sqlite3.IntegrityError as exc:
                if "node_id" in str(exc):
                    # Ids are global primary keys and client-minted: another owner holds this one.
                    raise _bad("node_id: already in use") from exc
                raise _bad("the node could not be stored") from exc
            row = self._one(
                f"SELECT {_NODE_COLUMNS} FROM canvas_nodes WHERE owner_id = ? AND node_id = ?",
                (owner_id, node_id),
            )
        assert row is not None
        return _node_row(row)

    def _check_group(
        self, owner_id: str, board_id: str, node_id: str, kind: object, group_id: object
    ) -> None:
        if group_id == node_id:
            raise _bad("group_id: a node cannot be in itself")
        if kind == "group":
            raise _bad("group_id: groups do not nest")
        parent = self._one(
            "SELECT kind FROM canvas_nodes WHERE owner_id = ? AND board_id = ? AND node_id = ?",
            (owner_id, board_id, group_id),
        )
        if parent is None or parent["kind"] != "group":
            raise _bad("group_id: not a group on this board")

    def patch_node(
        self,
        owner: OwnerId,
        board_id: str,
        node_id: str,
        version: int,
        fields: Mapping[str, Any],
    ) -> NodeRow | StaleVersion | None:
        """Changes the fields PRESENT in ``fields`` if ``version`` is the stored one.

        Optimistic concurrency: a stale ``version`` changes nothing and returns
        ``StaleVersion(current)`` (the route's 409 carries the node as it now is). A good write
        bumps ``version`` by one in a single UPDATE guarded by the version it read. None when the
        node is not on this owner's board. A present ``title`` / ``group_id`` of None clears it.
        """
        owner_id = self._resolve(owner)
        unknown = set(fields) - set(_NODE_PATCHABLE)
        if unknown:
            raise _bad(f"{sorted(unknown)[0]}: cannot be changed")
        sets: list[str] = []
        params: list[Any] = []
        for name in ("x", "y"):
            if name in fields:
                sets.append(f"{name} = ?")
                params.append(_finite(name, fields[name]))
        for name in ("w", "h"):
            if name in fields:
                sets.append(f"{name} = ?")
                params.append(_finite(name, fields[name], positive=True))
        if "z" in fields:
            sets.append("z = ?")
            params.append(int(fields["z"]))
        if "title" in fields:
            if fields["title"] is not None and not isinstance(fields["title"], str):
                raise _bad("title: must be a string or null")
            sets.append("title = ?")
            params.append(fields["title"])
        if "body" in fields:
            if not isinstance(fields["body"], str):
                raise _bad("body: must be a string")
            sets.append("body = ?")
            params.append(fields["body"])
        with self.transaction():
            current = self._one(
                f"SELECT {_NODE_COLUMNS} FROM canvas_nodes "
                "WHERE owner_id = ? AND board_id = ? AND node_id = ?",
                (owner_id, board_id, node_id),
            )
            if current is None:
                return None
            if current["version"] != version:
                return StaleVersion(_node_row(current))
            for name, owner_kind in (
                ("source_page_id", _KIND_WITH_SOURCE_PAGE),
                ("source_diagram_id", _KIND_WITH_SOURCE_DIAGRAM),
            ):
                if name in fields:
                    # Same rule as create: only its own kind carries one, and never cleared.
                    value = _source_ref(name, fields[name], current["kind"], owner_kind)
                    if name == "source_page_id":
                        assert value is not None
                        paper = self._one(
                            "SELECT paper_id FROM canvas_boards "
                            "WHERE owner_id = ? AND board_id = ?",
                            (owner_id, board_id),
                        )
                        assert paper is not None
                        self._check_source_page(owner_id, paper["paper_id"], value)
                    sets.append(f"{name} = ?")
                    params.append(value)
            if "group_id" in fields:
                if fields["group_id"] is not None:
                    self._check_group(
                        owner_id, board_id, node_id, current["kind"], fields["group_id"]
                    )
                sets.append("group_id = ?")
                params.append(fields["group_id"])
            sets += ["version = version + 1", "updated_at = ?"]
            params.append(now_iso())
            try:
                changed = self._conn.execute(
                    # Column names are the fixed literals above; only values are bound.
                    f"UPDATE canvas_nodes SET {', '.join(sets)} "
                    "WHERE owner_id = ? AND board_id = ? AND node_id = ? AND version = ?",
                    (*params, owner_id, board_id, node_id, version),
                ).rowcount
            except sqlite3.IntegrityError as exc:
                raise _bad("the node could not be changed") from exc
            row = self._one(
                f"SELECT {_NODE_COLUMNS} FROM canvas_nodes "
                "WHERE owner_id = ? AND board_id = ? AND node_id = ?",
                (owner_id, board_id, node_id),
            )
            assert row is not None
            if changed != 1:  # unreachable inside BEGIN IMMEDIATE; kept as the honest answer
                return StaleVersion(_node_row(row))
        return _node_row(row)

    def delete_node(self, owner: OwnerId, board_id: str, node_id: str) -> int:
        """Deletes a node: its edges go with it (FK cascade) and, for a group, the trigger
        ungroups the members first. Returns the number of nodes deleted (0: not found)."""
        owner_id = self._resolve(owner)
        with self.transaction():
            return self._conn.execute(
                "DELETE FROM canvas_nodes WHERE owner_id = ? AND board_id = ? AND node_id = ?",
                (owner_id, board_id, node_id),
            ).rowcount

    def create_edge(self, owner: OwnerId, board_id: str, edge: Mapping[str, Any]) -> EdgeRow:
        """Adds an edge between two different nodes of THIS board. Idempotent on ``edge_id``.

        :class:`CanvasRejected` ``not_found`` for an unknown board, ``validation_failed`` for a
        kind outside the seven or a node that is not on this board.
        """
        owner_id = self._resolve(owner)
        edge_id, a, b = edge.get("edge_id"), edge.get("from_node_id"), edge.get("to_node_id")
        kind, label = edge.get("kind"), edge.get("label")
        from_port, to_port = edge.get("from_port"), edge.get("to_port")
        if not isinstance(edge_id, str) or not edge_id:
            raise _bad("edge_id: required")
        if kind not in EDGE_KINDS:
            raise _bad("kind: not one of the seven edge kinds")
        if label is not None and not isinstance(label, str):
            raise _bad("label: must be a string or null")
        if not isinstance(a, str) or not isinstance(b, str) or a == b:
            raise _bad("to_node_id: an edge joins two different nodes")
        with self.transaction():
            self._require_board(owner_id, board_id)
            existing = self._one(
                f"SELECT {_EDGE_COLUMNS} FROM canvas_edges WHERE owner_id = ? AND edge_id = ?",
                (owner_id, edge_id),
            )
            if existing is not None:
                if existing["board_id"] == board_id:
                    return _edge_row(existing)
                raise _bad("edge_id: already in use")
            kinds = self._node_kinds(owner_id, board_id, (a, b))
            if len(kinds) != 2:
                raise _bad("from_node_id: both nodes must be on this board")
            check_ports(kinds[a], kinds[b], from_port, to_port)
            now = now_iso()
            try:
                self._conn.execute(
                    "INSERT INTO canvas_edges (edge_id, owner_id, board_id, from_node_id, "
                    "to_node_id, kind, label, created_at, updated_at, from_port, to_port) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (edge_id, owner_id, board_id, a, b, kind, label, now, now, from_port, to_port),
                )
            except sqlite3.IntegrityError as exc:
                raise _bad("edge_id: already in use") from exc
            row = self._one(
                f"SELECT {_EDGE_COLUMNS} FROM canvas_edges WHERE owner_id = ? AND edge_id = ?",
                (owner_id, edge_id),
            )
        assert row is not None
        return _edge_row(row)

    def _node_kinds(self, owner_id: str, board_id: str, ids: tuple[str, ...]) -> dict[str, str]:
        marks = ", ".join("?" for _ in ids)
        rows = self._all(
            "SELECT node_id, kind FROM canvas_nodes "  # noqa: S608 - only "?" is interpolated
            f"WHERE owner_id = ? AND board_id = ? AND node_id IN ({marks})",
            (owner_id, board_id, *ids),
        )
        return {r["node_id"]: r["kind"] for r in rows}

    def _require_board(self, owner_id: str, board_id: str) -> None:
        if (
            self._one(
                "SELECT 1 AS ok FROM canvas_boards WHERE owner_id = ? AND board_id = ?",
                (owner_id, board_id),
            )
            is None
        ):
            raise CanvasRejected("not_found", "no such board")

    def patch_edge(
        self, owner: OwnerId, board_id: str, edge_id: str, fields: Mapping[str, Any]
    ) -> EdgeRow | None:
        """Changes ``kind``, ``label``, ``from_port`` and/or ``to_port`` (a present ``label`` or
        port of None clears it; a port that stays set is re-checked against :data:`PIN_TABLE`)."""
        owner_id = self._resolve(owner)
        sets: list[str] = []
        params: list[Any] = []
        if "kind" in fields:
            if fields["kind"] not in EDGE_KINDS:
                raise _bad("kind: not one of the seven edge kinds")
            sets.append("kind = ?")
            params.append(fields["kind"])
        if "label" in fields:
            if fields["label"] is not None and not isinstance(fields["label"], str):
                raise _bad("label: must be a string or null")
            sets.append("label = ?")
            params.append(fields["label"])
        with self.transaction():
            if "from_port" in fields or "to_port" in fields:
                ends = self._one(
                    "SELECT from_node_id, to_node_id, from_port, to_port FROM canvas_edges "
                    "WHERE owner_id = ? AND board_id = ? AND edge_id = ?",
                    (owner_id, board_id, edge_id),
                )
                if ends is not None:
                    kinds = self._node_kinds(
                        owner_id, board_id, (ends["from_node_id"], ends["to_node_id"])
                    )
                    new_from = fields.get("from_port", ends["from_port"])
                    new_to = fields.get("to_port", ends["to_port"])
                    check_ports(
                        kinds[ends["from_node_id"]], kinds[ends["to_node_id"]], new_from, new_to
                    )
                    for name in ("from_port", "to_port"):
                        if name in fields:
                            sets.append(f"{name} = ?")
                            params.append(fields[name])
            if sets:
                self._conn.execute(
                    f"UPDATE canvas_edges SET {', '.join(sets)}, updated_at = ? "
                    "WHERE owner_id = ? AND board_id = ? AND edge_id = ?",
                    (*params, now_iso(), owner_id, board_id, edge_id),
                )
            row = self._one(
                f"SELECT {_EDGE_COLUMNS} FROM canvas_edges "
                "WHERE owner_id = ? AND board_id = ? AND edge_id = ?",
                (owner_id, board_id, edge_id),
            )
        return None if row is None else _edge_row(row)

    def delete_edge(self, owner: OwnerId, board_id: str, edge_id: str) -> int:
        owner_id = self._resolve(owner)
        return self._conn.execute(
            "DELETE FROM canvas_edges WHERE owner_id = ? AND board_id = ? AND edge_id = ?",
            (owner_id, board_id, edge_id),
        ).rowcount

    def patch_board(
        self, owner: OwnerId, board_id: str, fields: Mapping[str, Any]
    ) -> BoardRow | None:
        """Changes ``title`` and/or ``viewport`` (a present ``viewport`` of None clears it)."""
        owner_id = self._resolve(owner)
        sets: list[str] = []
        params: list[Any] = []
        if "title" in fields:
            title = fields["title"]
            if not isinstance(title, str) or not title.strip():
                raise _bad("title: must be a non-empty string")
            sets.append("title = ?")
            params.append(title)
        if "viewport" in fields:
            viewport = fields["viewport"]
            if viewport is None:
                sets.append("viewport_json = NULL")
            else:
                if not isinstance(viewport, Mapping) or set(viewport) != {"x", "y", "zoom"}:
                    raise _bad("viewport: must be {x, y, zoom}")
                value = {
                    "x": _finite("viewport.x", viewport["x"]),
                    "y": _finite("viewport.y", viewport["y"]),
                    "zoom": _finite("viewport.zoom", viewport["zoom"], positive=True),
                }
                sets.append("viewport_json = ?")
                params.append(client_json(value))
        with self.transaction():
            if sets:
                self._conn.execute(
                    f"UPDATE canvas_boards SET {', '.join(sets)}, updated_at = ? "
                    "WHERE owner_id = ? AND board_id = ?",
                    (*params, now_iso(), owner_id, board_id),
                )
            row = self._one(
                f"SELECT {_BOARD_COLUMNS} FROM canvas_boards WHERE owner_id = ? AND board_id = ?",
                (owner_id, board_id),
            )
        return None if row is None else _board_row(row)
