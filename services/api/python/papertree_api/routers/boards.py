"""contracts.md §2.7: the canvas. S7 builds these.

    GET     /papers/{id}/board                 -> BoardView (never writes)
    POST    /papers/{id}/board/nodes           NodeCreate  -> 201 NodeCreated (board created on
                                                              the first send, same transaction)
    PATCH   /boards/{bid}/nodes/{nid}          NodePatch   -> CanvasNode | 409 StaleVersion
    DELETE  /boards/{bid}/nodes/{nid}                      -> 204
    POST    /boards/{bid}/edges                EdgeCreate  -> 201 CanvasEdge
    PATCH   /boards/{bid}/edges/{eid}          EdgePatch   -> CanvasEdge
    DELETE  /boards/{bid}/edges/{eid}                      -> 204
    PATCH   /boards/{bid}                      BoardPatch  -> Board

BUILT BY S7. The model-level rules (an excerpt needs `source_anchor`, an explanation
`source_message_id`, an edge two different nodes) answer 422 in the models; the ones that need the
database (the anchor is on THIS paper, the answer is on THIS paper, the nodes are on THIS board)
answer 422 from `papertree_db.canvas` as `CanvasRejected`, mapped here.

`GET /papers/{id}/board` NEVER writes: a board exists only after an explicit send. The wire bodies
are built field by field (like the highlight routes), so a stored Anchor leaves exactly as it
arrived and nothing can carry `owner_id`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from papertree_db import BoardRow, CanvasRejected, EdgeRow, NodeRow, PaperId, StaleVersion

from ..deps import Caller, CallerDep
from ..errors import ApiError
from ..schemas import (
    Board,
    BoardPatch,
    BoardView,
    CanvasEdge,
    CanvasNode,
    EdgeCreate,
    EdgePatch,
    NodeCreate,
    NodeCreated,
    NodePatch,
)
from ..schemas import StaleVersion as StaleVersionBody
from ..wiretime import wire_time
from ._shared import read_json

router = APIRouter()


def _owned_or_404(call: Caller, paper_id: str) -> None:
    if call.db.owned_paper(call.db_owner, PaperId(paper_id)) is None:
        raise ApiError("not_found", "no such paper")


def _board_wire(board: BoardRow) -> dict[str, Any]:
    return {
        "board_id": board.board_id,
        "paper_id": board.paper_id,
        "title": board.title,
        "viewport": None if board.viewport is None else dict(board.viewport),
        "created_at": wire_time(board.created_at),
        "updated_at": wire_time(board.updated_at),
    }


def _node_wire(node: NodeRow) -> dict[str, Any]:
    return {
        "node_id": node.node_id,
        "board_id": node.board_id,
        "kind": node.kind,
        "group_id": node.group_id,
        "x": node.x,
        "y": node.y,
        "w": node.w,
        "h": node.h,
        "z": node.z,
        "title": node.title,
        "body": node.body,
        "source_anchor": None if node.source_anchor is None else dict(node.source_anchor),
        "source_message_id": node.source_message_id,
        "version": node.version,
        "created_at": wire_time(node.created_at),
        "updated_at": wire_time(node.updated_at),
    }


def _edge_wire(edge: EdgeRow) -> dict[str, Any]:
    return {
        "edge_id": edge.edge_id,
        "board_id": edge.board_id,
        "from_node_id": edge.from_node_id,
        "to_node_id": edge.to_node_id,
        "kind": edge.kind,
        "label": edge.label,
    }


def _guard[T](action: Callable[[], T]) -> T:
    """Runs a data-layer call and turns its `CanvasRejected` into the contract's envelope."""
    try:
        return action()
    except CanvasRejected as exc:
        raise ApiError(exc.code, exc.detail) from exc


@router.get("/papers/{paper_id}/board", response_model=BoardView)
async def get_board(call: CallerDep, paper_id: str) -> Response:
    """`board: null` and no nodes until the first explicit send. Reads only."""
    _owned_or_404(call, paper_id)
    snapshot = call.db.get_board(call.db_owner, PaperId(paper_id))
    return JSONResponse(
        {
            "board": None if snapshot.board is None else _board_wire(snapshot.board),
            "nodes": [_node_wire(n) for n in snapshot.nodes],
            "edges": [_edge_wire(e) for e in snapshot.edges],
        }
    )


@router.post("/papers/{paper_id}/board/nodes", response_model=NodeCreated, status_code=201)
async def create_node(call: CallerDep, paper_id: str, request: Request) -> Response:
    """201 `{board, node}`; the board is created in the same transaction on the first send."""
    body, raw = await read_json(request, NodeCreate)
    _owned_or_404(call, paper_id)
    node: dict[str, Any] = {
        key: value for key, value in raw.items() if key in NodeCreate.model_fields
    }
    node["node_id"] = body.node_id
    if isinstance(node.get("source_anchor"), dict):
        node["source_anchor"] = {
            k: v for k, v in node["source_anchor"].items() if k != "resolution"
        }
    stored = _guard(lambda: call.db.create_node(call.db_owner, PaperId(paper_id), node))
    snapshot = call.db.get_board(call.db_owner, PaperId(paper_id))
    assert snapshot.board is not None  # created in the same transaction as the node
    return JSONResponse(
        {"board": _board_wire(snapshot.board), "node": _node_wire(stored)}, status_code=201
    )


@router.patch(
    "/boards/{board_id}/nodes/{node_id}",
    response_model=CanvasNode,
    responses={409: {"model": StaleVersionBody}},
)
async def patch_node(call: CallerDep, board_id: str, node_id: str, request: Request) -> Response:
    """200 with `version + 1`; a stale `version` is 409 `stale_version` carrying `current`."""
    body, _ = await read_json(request, NodePatch)
    fields = {k: getattr(body, k) for k in body.model_fields_set if k != "version"}
    result = _guard(
        lambda: call.db.patch_node(call.db_owner, board_id, node_id, body.version, fields)
    )
    if result is None:
        raise ApiError("not_found", "no such node on this board")
    if isinstance(result, StaleVersion):
        raise ApiError(
            "stale_version",
            "This note changed somewhere else. The latest version is shown; try again.",
            extra={"current": _node_wire(result.current)},
        )
    return JSONResponse(_node_wire(result))


@router.delete("/boards/{board_id}/nodes/{node_id}", status_code=204)
async def delete_node(call: CallerDep, board_id: str, node_id: str) -> Response:
    if call.db.delete_node(call.db_owner, board_id, node_id) == 0:
        raise ApiError("not_found", "no such node on this board")
    return Response(status_code=204)


@router.post("/boards/{board_id}/edges", response_model=CanvasEdge, status_code=201)
async def create_edge(call: CallerDep, board_id: str, request: Request) -> Response:
    body, _ = await read_json(request, EdgeCreate)
    edge = _guard(
        lambda: call.db.create_edge(
            call.db_owner,
            board_id,
            {
                "edge_id": body.edge_id,
                "from_node_id": body.from_node_id,
                "to_node_id": body.to_node_id,
                "kind": body.kind,
                "label": body.label,
            },
        )
    )
    return JSONResponse(_edge_wire(edge), status_code=201)


@router.patch("/boards/{board_id}/edges/{edge_id}", response_model=CanvasEdge)
async def patch_edge(call: CallerDep, board_id: str, edge_id: str, request: Request) -> Response:
    body, _ = await read_json(request, EdgePatch)
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    edge = _guard(lambda: call.db.patch_edge(call.db_owner, board_id, edge_id, fields))
    if edge is None:
        raise ApiError("not_found", "no such edge on this board")
    return JSONResponse(_edge_wire(edge))


@router.delete("/boards/{board_id}/edges/{edge_id}", status_code=204)
async def delete_edge(call: CallerDep, board_id: str, edge_id: str) -> Response:
    if call.db.delete_edge(call.db_owner, board_id, edge_id) == 0:
        raise ApiError("not_found", "no such edge on this board")
    return Response(status_code=204)


@router.patch("/boards/{board_id}", response_model=Board)
async def patch_board(call: CallerDep, board_id: str, request: Request) -> Response:
    body, _ = await read_json(request, BoardPatch)
    fields: dict[str, Any] = {}
    if "title" in body.model_fields_set:
        fields["title"] = body.title
    if "viewport" in body.model_fields_set:
        fields["viewport"] = None if body.viewport is None else body.viewport.model_dump()
    board = _guard(lambda: call.db.patch_board(call.db_owner, board_id, fields))
    if board is None:
        raise ApiError("not_found", "no such board")
    return JSONResponse(_board_wire(board))
