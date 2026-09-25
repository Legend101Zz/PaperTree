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

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

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


class CanvasMixin(_Base):
    __slots__ = ()

    def get_board(self, owner: OwnerId, paper_id: PaperId) -> BoardSnapshot:
        raise NotImplementedError("S7 implements get_board (contracts.md §1.1)")

    def create_node(self, owner: OwnerId, paper_id: PaperId, node: Mapping[str, Any]) -> NodeRow:
        raise NotImplementedError("S7 implements create_node (contracts.md §1.1)")

    def patch_node(
        self,
        owner: OwnerId,
        board_id: str,
        node_id: str,
        version: int,
        fields: Mapping[str, Any],
    ) -> NodeRow | StaleVersion:
        raise NotImplementedError("S7 implements patch_node (contracts.md §1.1)")

    def delete_node(self, owner: OwnerId, board_id: str, node_id: str) -> int:
        raise NotImplementedError("S7 implements delete_node (contracts.md §1.1)")

    def create_edge(self, owner: OwnerId, board_id: str, edge: Mapping[str, Any]) -> EdgeRow:
        raise NotImplementedError("S7 implements create_edge (contracts.md §1.1)")

    def patch_edge(
        self, owner: OwnerId, board_id: str, edge_id: str, fields: Mapping[str, Any]
    ) -> EdgeRow | None:
        raise NotImplementedError("S7 implements patch_edge (contracts.md §1.1)")

    def delete_edge(self, owner: OwnerId, board_id: str, edge_id: str) -> int:
        raise NotImplementedError("S7 implements delete_edge (contracts.md §1.1)")

    def patch_board(
        self, owner: OwnerId, board_id: str, fields: Mapping[str, Any]
    ) -> BoardRow | None:
        raise NotImplementedError("S7 implements patch_board (contracts.md §1.1)")
