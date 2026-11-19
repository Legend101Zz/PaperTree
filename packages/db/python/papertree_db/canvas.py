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
    #: The branching board (0016, v0.3 #343): the card this one hangs from and which way it leaves
    #: it (``down`` / ``right``), the words of the parent's answer it starts from, the ask an
    #: answer card answers, what that ask read, the user's drag offset on top of the Tidy layout,
    #: and whether the subtree under it is folded. All None / zero on a v0.2 card.
    parent_id: str | None = None
    branch: str | None = None
    parent_span: Mapping[str, Any] | None = None
    question: str | None = None
    uses: Mapping[str, Any] | None = None
    offset_x: float = 0.0
    offset_y: float = 0.0
    folded: bool = False


@dataclass(frozen=True, slots=True)
class NodeAnswer:
    """What an answer card shows, read in ONE query for the whole board (not a thread fetch per
    card): the stored final text of its message, the level it was written at, the model that wrote
    it and the message's status (``streaming`` while the run is live)."""

    final_text: str
    level: str | None
    model: str | None
    status: str
    #: The user turn this answer answers (the message before it in its thread), and the anchor its
    #: thread started from: what a path needs from a v0.2 answer card that has no ``question`` and
    #: no parent (the card is then the root of its own path).
    asked: str | None = None
    origin_anchor: Mapping[str, Any] | None = None
    #: The run that writes (or wrote) the answer: a ``streaming`` answer whose run is gone is
    #: shown as ended, not as a stream a reader would wait on forever.
    run_id: str | None = None
    #: The answer's citations (handle -> page and Anchor), in ordinal order, read in the same query
    #: as ``final_text`` so a board of any size resolves every ``[bN]`` without a thread read per
    #: card (the old scan stopped at the newest 20 threads). Empty for an answer with none.
    citations: tuple[Mapping[str, Any], ...] = ()


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
    #: 0016: for every explanation card, its answer (final text, level, model, status).
    answers: Mapping[str, NodeAnswer] = field(default_factory=dict)


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
#: Re-derived from reference/06-board-1440.png, card by card. What the frame DRAWS:
#:   passage (excerpt): ring (evidence in) on the left, brass dot (claim out) on the right
#:   explanation: ring left, brass dot right, brass diamond (answer out) on the bottom edge
#:   note: ring left, brass dot right
#:   question: open diamond (question in) on the top edge
#:   notebook page: ring left
#:   diagram: ring left, brass dot right
#: Pins the frame does NOT draw but the design text (DESIGN.md section 5, the brief) allows, kept
#: so a legal thread is never refused for want of a drawing: question_in on an explanation,
#: evidence_in on a question, claim_out on a notebook page. The thread the frame's own picker
#: shows (diagram claim_out -> passage evidence_in) is why a passage takes an in-pin.
PIN_TABLE: Final[Mapping[str, Pins]] = {
    "excerpt": Pins(out=frozenset({"claim_out"}), into=frozenset({"evidence_in"})),
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
    "x", "y", "w", "h", "z", "title", "body", "group_id", "source_page_id", "source_diagram_id",
    "offset_x", "offset_y", "folded",
)  # fmt: skip
_NODE_COLUMNS: Final = (
    "node_id, board_id, kind, group_id, x, y, w, h, z, title, body, source_anchor_json, "
    "source_message_id, version, created_at, updated_at, source_page_id, source_diagram_id, "
    "parent_id, branch, parent_span_json, question, uses_json, offset_x, offset_y, folded"
)
#: The tree (0016): only these kinds hang from a parent, and only these kinds are asked about.
CHILD_KINDS: Final = frozenset({"explanation", "note"})
PARENT_KINDS: Final = frozenset({"excerpt", "explanation"})
BRANCHES: Final = frozenset({"down", "right"})
USES_PAPER: Final = frozenset({"page", "whole", "off"})
USES_LEVEL: Final = frozenset({"new", "familiar", "expert"})
USES_DIAGRAM: Final = frozenset({"may", "never", "always"})
QUESTION_MAX: Final = 2000
SPAN_QUOTE_MAX: Final = 2000
EXTRA_NODES_MAX: Final = 12


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


def utf16_length(text: str) -> int:
    """The length of ``text`` in UTF-16 code units, which is how a span's offsets count (the
    web's JavaScript string indexes): an astral character is two."""
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def utf16_slice(text: str, start: int, end: int) -> str | None:
    """``text[start:end]`` in UTF-16 code units; None when a cut falls inside a surrogate pair."""
    units = text.encode("utf-16-le", "surrogatepass")
    try:
        return units[2 * start : 2 * end].decode("utf-16-le")
    except UnicodeDecodeError:
        return None


def check_span(span: object, text: str) -> dict[str, Any]:
    """A parent span ``{start, end, quote}`` held to the parent's stored answer ``text``: UTF-16
    offsets inside it, ``start < end``, and the quote EXACTLY the words at those offsets (so a span
    can never point at words the answer does not hold). Returns the stored form."""
    if not isinstance(span, Mapping) or set(span) != {"start", "end", "quote"}:
        raise _bad("parent_span: must be {start, end, quote}")
    start, end, quote = span["start"], span["end"], span["quote"]
    if (
        isinstance(start, bool)
        or isinstance(end, bool)
        or not isinstance(start, int)
        or not isinstance(end, int)
        or not isinstance(quote, str)
    ):
        raise _bad("parent_span: start and end are integers, quote is text")
    if not 0 <= start < end <= utf16_length(text):
        raise _bad("parent_span: the offsets are not inside the answer")
    if not quote or len(quote) > SPAN_QUOTE_MAX:
        raise _bad(f"parent_span.quote: 1 to {SPAN_QUOTE_MAX} characters")
    if utf16_slice(text, start, end) != quote:
        raise _bad("parent_span: the quote is not the words at those offsets of the answer")
    return {"start": start, "end": end, "quote": quote}


def check_uses(uses: object) -> dict[str, Any]:
    """``uses`` as an ask stores it: what the AI read, so the card can say so later."""
    if not isinstance(uses, Mapping) or set(uses) != {
        "path", "paper", "level", "diagram", "extra_node_ids"
    }:  # fmt: skip
        raise _bad("uses: must be {path, paper, level, diagram, extra_node_ids}")
    extra = uses["extra_node_ids"]
    if (
        not isinstance(uses["path"], bool)
        or uses["paper"] not in USES_PAPER
        or uses["level"] not in USES_LEVEL
        or uses["diagram"] not in USES_DIAGRAM
        or not isinstance(extra, list)
        or len(extra) > EXTRA_NODES_MAX
        or not all(isinstance(item, str) and item for item in extra)
        or len(set(extra)) != len(extra)
    ):
        raise _bad("uses: a value is not one of the allowed ones")
    return {
        "path": uses["path"],
        "paper": uses["paper"],
        "level": uses["level"],
        "diagram": uses["diagram"],
        "extra_node_ids": list(extra),
    }


def _node_row(row: Row) -> NodeRow:
    anchor = row["source_anchor_json"]
    span = row["parent_span_json"]
    uses = row["uses_json"]
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
        parent_id=row["parent_id"],
        branch=row["branch"],
        parent_span=None if span is None else json.loads(span),
        question=row["question"],
        uses=None if uses is None else json.loads(uses),
        offset_x=row["offset_x"],
        offset_y=row["offset_y"],
        folded=bool(row["folded"]),
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


@dataclass(slots=True)
class _TreeInput:
    """The branching-board fields of a node being created, parsed (``_tree_input``) before the
    transaction and finished inside it (``_check_parent`` verifies the span against the parent)."""

    parent_id: str | None = None
    branch: str | None = None
    span: Mapping[str, Any] | None = None
    span_json: str | None = None
    question: str | None = None
    uses_json: str | None = None
    offset_x: float = 0.0
    offset_y: float = 0.0
    folded: bool = False


def _tree_input(node: Mapping[str, Any], kind: str, node_id: str) -> _TreeInput:
    parent_id, branch = node.get("parent_id"), node.get("branch")
    span, question, uses = node.get("parent_span"), node.get("question"), node.get("uses")
    tree = _TreeInput(
        offset_x=_finite("offset_x", node.get("offset_x", 0)),
        offset_y=_finite("offset_y", node.get("offset_y", 0)),
    )
    folded = node.get("folded", False)
    if not isinstance(folded, bool):
        raise _bad("folded: must be true or false")
    tree.folded = folded
    if parent_id is None:
        if branch is not None or span is not None:
            raise _bad("branch: only a card with a parent_id has a branch or a span")
    else:
        if not isinstance(parent_id, str) or not parent_id or parent_id == node_id:
            raise _bad("parent_id: must be another card of this board")
        if kind not in CHILD_KINDS:
            raise _bad("parent_id: only an answer or a note hangs from another card")
        if branch not in BRANCHES:
            raise _bad("branch: must be down or right")
        if kind == "note" and branch != "right":
            raise _bad("branch: a note always branches right")
        if span is not None and branch != "right":
            raise _bad("branch: a branch from a span leaves to the right")
        tree.parent_id, tree.branch, tree.span = parent_id, str(branch), span
    if question is not None or uses is not None:
        if kind != "explanation":
            raise _bad("question: only an answer card carries the ask")
        if question is not None and (
            not isinstance(question, str) or not 1 <= len(question) <= QUESTION_MAX
        ):
            raise _bad(f"question: 1 to {QUESTION_MAX} characters")
        tree.question = question
        tree.uses_json = None if uses is None else client_json(check_uses(uses))
    return tree


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
        return self._snapshot(owner_id, board)

    def get_board_by_id(self, owner: OwnerId, board_id: str) -> BoardSnapshot:
        """The same snapshot for a board named by its id (``board=None``: not this owner's)."""
        owner_id = self._resolve(owner)
        board = self._one(
            f"SELECT {_BOARD_COLUMNS} FROM canvas_boards WHERE owner_id = ? AND board_id = ?",
            (owner_id, board_id),
        )
        return self._snapshot(owner_id, board)

    def _snapshot(self, owner_id: str, board: Row | None) -> BoardSnapshot:
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
            self._node_answers(owner_id, node_rows),
        )

    def node_answers(self, owner: OwnerId, nodes: tuple[NodeRow, ...]) -> dict[str, NodeAnswer]:
        """The answers of the explanation cards among ``nodes`` (a single created or patched card
        needs this; ``get_board`` already includes it for the whole board)."""
        return self._node_answers(self._resolve(owner), nodes)

    def _node_answers(self, owner_id: str, nodes: tuple[NodeRow, ...]) -> dict[str, NodeAnswer]:
        """Final text, level, model, status and citations of every explanation card in ONE query:
        the card's message, the run that wrote it (the model), the question before it, its thread's
        origin anchor and its citations. No query per card."""
        cards = {n.source_message_id: n.node_id for n in nodes if n.kind == "explanation"}
        cards.pop(None, None)
        if not cards:
            return {}
        ids = sorted(str(k) for k in cards)
        marks = ", ".join("?" for _ in ids)
        rows = self._all(
            "SELECT m.message_id AS message_id, m.content AS content, m.level AS level, "  # noqa: S608
            "m.status AS status, m.run_id AS run_id, r.model AS model, "
            "t.origin_anchor_json AS origin, "
            "(SELECT json_group_array(json_object('citation_id', c.citation_id, "
            "'ordinal', c.ordinal, 'marker', c.marker, 'page_index', c.page_index, "
            "'anchor', json(c.anchor_json))) FROM (SELECT * FROM ai_citations x "
            "WHERE x.owner_id = m.owner_id AND x.message_id = m.message_id "
            "ORDER BY x.ordinal) c) AS cites, "
            "(SELECT u.content FROM ai_messages u WHERE u.owner_id = m.owner_id "
            "AND u.thread_id = m.thread_id AND u.role = 'user' AND u.ordinal < m.ordinal "
            "ORDER BY u.ordinal DESC LIMIT 1) AS asked "
            "FROM ai_messages m JOIN ai_threads t "
            "ON t.owner_id = m.owner_id AND t.thread_id = m.thread_id "
            "LEFT JOIN ai_runs r ON r.owner_id = m.owner_id AND r.run_id = m.run_id "
            f"WHERE m.owner_id = ? AND m.message_id IN ({marks})",
            (owner_id, *ids),
        )
        out: dict[str, NodeAnswer] = {}
        for r in rows:
            origin = r["origin"]
            model = r["model"]
            out[cards[r["message_id"]]] = NodeAnswer(
                final_text=r["content"],
                level=r["level"],
                model=model,
                status=r["status"],
                asked=r["asked"],
                origin_anchor=None if origin is None else json.loads(origin),
                run_id=r["run_id"],
                citations=tuple(json.loads(r["cites"] or "[]")),
            )
        return out

    def notebook_counts(
        self, owner: OwnerId, nodes: tuple[NodeRow, ...]
    ) -> dict[str, NotebookCounts]:
        """Counts for the notebook cards among ``nodes`` (what a single patched or created card
        needs; ``get_board`` already includes them for the whole board)."""
        return self._notebook_counts(self._resolve(owner), nodes)

    def _notebook_counts(
        self, owner_id: str, nodes: tuple[NodeRow, ...]
    ) -> dict[str, NotebookCounts]:
        """Counts for every notebook card in ONE grouped query (no query per card).

        Items and strokes are counted from the real notebook tables (0007), owner-scoped. A page
        with nothing on it (or, through a direct SQL delete, none at all) reads as zeros.
        """
        cards = [n for n in nodes if n.kind == "notebook" and n.source_page_id is not None]
        if not cards:
            return {}
        found: dict[str, dict[str, int]] = {}
        pages = sorted({str(c.source_page_id) for c in cards})
        marks = ", ".join("?" for _ in pages)
        rows = self._all(
            "SELECT page_id, kind, COUNT(*) AS n FROM notebook_items "  # noqa: S608 - only "?"
            f"WHERE owner_id = ? AND page_id IN ({marks}) GROUP BY page_id, kind "
            "UNION ALL "
            "SELECT page_id, 'stroke', COUNT(*) FROM notebook_strokes "
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
        stranger's page id is indistinguishable from a missing one)."""
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
        tree = _tree_input(node, kind, node_id)

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
            if tree.parent_id is not None:
                self._check_parent(owner_id, board_id, kind, tree)
            try:
                self._conn.execute(
                    "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, group_id, x, y, "
                    "w, h, z, title, body, source_anchor_json, source_message_id, version, "
                    "created_at, updated_at, source_page_id, source_diagram_id, parent_id, branch, "
                    "parent_span_json, question, uses_json, offset_x, offset_y, folded) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        node_id, owner_id, board_id, kind, group_id, x, y, w, h, int(z), title,
                        body, anchor_json, message_id, now, now, page_id, diagram_id,
                        tree.parent_id, tree.branch, tree.span_json, tree.question, tree.uses_json,
                        tree.offset_x, tree.offset_y, int(tree.folded),
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

    def _check_parent(self, owner_id: str, board_id: str, kind: str, tree: _TreeInput) -> None:
        """Rules 3 and 4 (spec §1), enforced where the row is written: the parent is a passage or
        an answer of THIS board; a span branch is ``right`` and its words are exactly the words at
        its offsets of the parent's stored answer; and a card has at most one ``down`` child."""
        parent = self._one(
            "SELECT kind, source_message_id FROM canvas_nodes "
            "WHERE owner_id = ? AND board_id = ? AND node_id = ?",
            (owner_id, board_id, tree.parent_id),
        )
        if parent is None:
            raise _bad("parent_id: not a card on this board")
        if parent["kind"] not in PARENT_KINDS:
            raise _bad("parent_id: only a passage or an answer takes a branch")
        if tree.span is not None:
            if parent["kind"] != "explanation":
                raise _bad("parent_span: only an answer has words to branch from")
            answer = self._one(
                "SELECT content, status FROM ai_messages WHERE owner_id = ? AND message_id = ?",
                (owner_id, parent["source_message_id"]),
            )
            if answer is None or answer["status"] == "streaming":
                raise _bad("parent_span: the answer is still being written")
            tree.span = check_span(tree.span, answer["content"])
            tree.span_json = client_json(tree.span)
        if tree.branch == "down":
            if parent["kind"] != "explanation":
                raise _bad("branch: only an answer continues downward; a passage branches right")
            taken = self._one(
                "SELECT 1 AS ok FROM canvas_nodes WHERE owner_id = ? AND board_id = ? "
                "AND parent_id = ? AND branch = 'down'",
                (owner_id, board_id, tree.parent_id),
            )
            if taken is not None:
                raise _bad("branch: this card already has a follow-up below it; branch right")

    def has_children(self, owner: OwnerId, board_id: str, node_id: str) -> bool:
        """Whether any card hangs from this one (rule 6: an answer with children is frozen)."""
        owner_id = self._resolve(owner)
        return (
            self._one(
                "SELECT 1 AS ok FROM canvas_nodes WHERE owner_id = ? AND board_id = ? "
                "AND parent_id = ? LIMIT 1",
                (owner_id, board_id, node_id),
            )
            is not None
        )

    def swap_answer(
        self,
        owner: OwnerId,
        board_id: str,
        node_id: str,
        *,
        message_id: str,
        uses: Mapping[str, Any] | None,
        restore: bool = False,
    ) -> NodeRow | None:
        """A retry of a FAILED answer that has no children replaces it: the card keeps its place,
        its id and its question and now shows ``message_id`` (rule 6). None when the card is not on
        this board; :class:`CanvasRejected` when it has children or its answer did not fail.
        ``restore`` puts an earlier answer back (a retry the agent refused) and skips that check."""
        owner_id = self._resolve(owner)
        checked = None if uses is None else check_uses(uses)
        with self.transaction():
            current = self._one(
                f"SELECT {_NODE_COLUMNS} FROM canvas_nodes "
                "WHERE owner_id = ? AND board_id = ? AND node_id = ?",
                (owner_id, board_id, node_id),
            )
            if current is None:
                return None
            if current["kind"] != "explanation":
                raise _bad("node: only an answer is retried")
            if self.has_children(owner, board_id, node_id):
                raise _bad("node: an answer with branches is never rewritten; make a sibling")
            old = self._one(
                "SELECT status FROM ai_messages WHERE owner_id = ? AND message_id = ?",
                (owner_id, current["source_message_id"]),
            )
            if (
                not restore
                and old is not None
                and old["status"] not in ("error", "partial", "aborted")
            ):
                raise _bad("node: only a failed answer is replaced")
            self._conn.execute(
                "UPDATE canvas_nodes SET source_message_id = ?, uses_json = ?, "
                "version = version + 1, updated_at = ? "
                "WHERE owner_id = ? AND board_id = ? AND node_id = ?",
                (
                    message_id,
                    None if checked is None else client_json(checked),
                    now_iso(),
                    owner_id,
                    board_id,
                    node_id,
                ),
            )
            row = self._one(
                f"SELECT {_NODE_COLUMNS} FROM canvas_nodes "
                "WHERE owner_id = ? AND board_id = ? AND node_id = ?",
                (owner_id, board_id, node_id),
            )
        assert row is not None
        return _node_row(row)

    def tidy(self, owner: OwnerId, board_id: str, node_id: str) -> list[NodeRow] | None:
        """Tidy one tree: every card of the tree that holds ``node_id`` (the card itself, its
        root and everything under the root) gets ``offset_x = offset_y = 0`` and a new version.
        Other trees and loose cards are not touched. None when the card is not on this board."""
        owner_id = self._resolve(owner)
        with self.transaction():
            if (
                self._one(
                    "SELECT 1 AS ok FROM canvas_nodes WHERE owner_id = ? AND board_id = ? "
                    "AND node_id = ?",
                    (owner_id, board_id, node_id),
                )
                is None
            ):
                return None
            root = self._root_of(owner_id, board_id, node_id)
            ids = [r["node_id"] for r in self._subtree(owner_id, board_id, root)]
            marks = ", ".join("?" for _ in ids)
            self._conn.execute(
                "UPDATE canvas_nodes SET offset_x = 0, offset_y = 0, version = version + 1, "  # noqa: S608
                f"updated_at = ? WHERE owner_id = ? AND board_id = ? AND node_id IN ({marks})",
                (now_iso(), owner_id, board_id, *ids),
            )
            rows = self._all(
                f"SELECT {_NODE_COLUMNS} FROM canvas_nodes "  # noqa: S608
                f"WHERE owner_id = ? AND board_id = ? AND node_id IN ({marks}) "
                "ORDER BY z, created_at, node_id",
                (owner_id, board_id, *ids),
            )
        return [_node_row(r) for r in rows]

    def _root_of(self, owner_id: str, board_id: str, node_id: str) -> str:
        """The top of ``node_id``'s tree (itself for a root or a loose card)."""
        row = self._one(
            "WITH RECURSIVE up(node_id, parent_id, depth) AS ("
            "SELECT node_id, parent_id, 0 FROM canvas_nodes "
            "WHERE owner_id = ? AND board_id = ? AND node_id = ? "
            "UNION ALL SELECT n.node_id, n.parent_id, up.depth + 1 FROM canvas_nodes n "
            "JOIN up ON n.node_id = up.parent_id "
            "WHERE n.owner_id = ? AND n.board_id = ? AND up.depth < 256) "
            "SELECT node_id FROM up ORDER BY depth DESC LIMIT 1",
            (owner_id, board_id, node_id, owner_id, board_id),
        )
        assert row is not None
        return str(row["node_id"])

    def _subtree(self, owner_id: str, board_id: str, node_id: str) -> list[Row]:
        """``node_id`` and every card under it (children first level by level; depth-capped)."""
        return self._all(
            "WITH RECURSIVE down(node_id, depth) AS ("
            "SELECT node_id, 0 FROM canvas_nodes "
            "WHERE owner_id = ? AND board_id = ? AND node_id = ? "
            "UNION ALL SELECT n.node_id, down.depth + 1 FROM canvas_nodes n "
            "JOIN down ON n.parent_id = down.node_id "
            "WHERE n.owner_id = ? AND n.board_id = ? AND down.depth < 256) "
            "SELECT node_id, depth FROM down ORDER BY depth",
            (owner_id, board_id, node_id, owner_id, board_id),
        )

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
        for name in ("offset_x", "offset_y"):
            if name in fields:
                sets.append(f"{name} = ?")
                params.append(_finite(name, fields[name]))
        if "folded" in fields:
            if not isinstance(fields["folded"], bool):
                raise _bad("folded: must be true or false")
            sets.append("folded = ?")
            params.append(int(fields["folded"]))
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
                    if value is None:
                        raise _bad(f"{name}: a card's source cannot be cleared")
                    if name == "source_page_id":
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
        """Deletes a node AND its whole subtree in one statement (0016): every card that hangs
        from it, however deep. Edges go with their cards (FK cascade) and, for a group, the trigger
        ungroups the members first. Returns the number of nodes deleted (0: not found).

        The threads and messages behind the answers stay, so an undo can put each card back with
        the same ``source_message_id`` (parents first: a child is created after its parent)."""
        owner_id = self._resolve(owner)
        with self.transaction():
            ids = [r["node_id"] for r in self._subtree(owner_id, board_id, node_id)]
            if not ids:
                return 0
            marks = ", ".join("?" for _ in ids)
            return self._conn.execute(
                "DELETE FROM canvas_nodes WHERE owner_id = ? AND board_id = ? "  # noqa: S608
                f"AND node_id IN ({marks})",
                (owner_id, board_id, *ids),
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
