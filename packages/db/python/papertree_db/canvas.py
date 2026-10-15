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
from dataclasses import dataclass
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


@dataclass(frozen=True, slots=True)
class BoardSnapshot:
    """``GET /papers/{id}/board``: ``board`` is None until the first send; then nodes and edges."""

    board: BoardRow | None
    nodes: tuple[NodeRow, ...]
    edges: tuple[EdgeRow, ...]


NODE_KINDS: Final = frozenset({"excerpt", "explanation", "note", "group"})
EDGE_KINDS: Final = frozenset(
    {"supports", "contradicts", "derives_from", "answers", "compares", "references", "relates"}
)
_NODE_PATCHABLE: Final = ("x", "y", "w", "h", "z", "title", "body", "group_id")
_NODE_COLUMNS: Final = (
    "node_id, board_id, kind, group_id, x, y, w, h, z, title, body, source_anchor_json, "
    "source_message_id, version, created_at, updated_at"
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
    )


_BOARD_COLUMNS: Final = "board_id, paper_id, title, viewport_json, created_at, updated_at"
_EDGE_COLUMNS: Final = "edge_id, board_id, from_node_id, to_node_id, kind, label"


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
        return BoardSnapshot(
            _board_row(board),
            tuple(_node_row(r) for r in nodes),
            tuple(_edge_row(r) for r in edges),
        )

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
            raise _bad("kind: must be excerpt, explanation, note or group")
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
        elif message_id is not None:
            raise _bad("source_message_id: only an explanation carries one")
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
            if kind == "explanation":
                assert isinstance(message_id, str)
                known = self._one(
                    "SELECT 1 AS ok FROM ai_messages m JOIN ai_threads t "
                    "ON t.owner_id = m.owner_id AND t.thread_id = m.thread_id "
                    "WHERE m.owner_id = ? AND m.message_id = ? AND t.paper_id = ? "
                    "AND m.role = 'assistant'",
                    (owner_id, message_id, paper_id),
                )
                if known is None:
                    raise _bad("source_message_id: no such answer on this paper")
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
                    "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
                    (
                        node_id, owner_id, board_id, kind, group_id, x, y, w, h, int(z), title,
                        body, anchor_json, message_id, now, now,
                    ),
                )  # fmt: skip
            except sqlite3.IntegrityError as exc:
                raise _bad(f"the node could not be stored ({exc})") from exc
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
                raise _bad(f"the node could not be changed ({exc})") from exc
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
            found = self._one(
                "SELECT COUNT(*) AS n FROM canvas_nodes "
                "WHERE owner_id = ? AND board_id = ? AND node_id IN (?, ?)",
                (owner_id, board_id, a, b),
            )
            if found is None or found["n"] != 2:
                raise _bad("from_node_id: both nodes must be on this board")
            now = now_iso()
            self._conn.execute(
                "INSERT INTO canvas_edges (edge_id, owner_id, board_id, from_node_id, "
                "to_node_id, kind, label, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (edge_id, owner_id, board_id, a, b, kind, label, now, now),
            )
            row = self._one(
                f"SELECT {_EDGE_COLUMNS} FROM canvas_edges WHERE owner_id = ? AND edge_id = ?",
                (owner_id, edge_id),
            )
        assert row is not None
        return _edge_row(row)

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
        """Changes ``kind`` and/or ``label`` (a present ``label`` of None clears it)."""
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
