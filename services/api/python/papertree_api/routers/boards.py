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

501 STUBS WITH THEIR FINAL MODELS (S0). The model-level rules (an excerpt needs `source_anchor`,
an explanation `source_message_id`, an edge two different nodes) already answer 422; the ones that
need the database (the anchor is on THIS paper, the nodes are on THIS board) are S7's.
"""

from __future__ import annotations

from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response

from ..deps import CallerDep
from ..errors import ErrorEnvelope, not_implemented
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
    StaleVersion,
)
from ._shared import json_body

router = APIRouter()

SLICE: Final = "S7"
NOT_YET: Final[dict[int | str, dict[str, Any]]] = {
    501: {"model": ErrorEnvelope, "description": f"Not implemented yet (slice {SLICE})"}
}


@router.get("/papers/{paper_id}/board", response_model=BoardView, responses=NOT_YET)
async def get_board(call: CallerDep, paper_id: str) -> BoardView:
    raise not_implemented(SLICE)


@router.post(
    "/papers/{paper_id}/board/nodes",
    response_model=NodeCreated,
    status_code=status.HTTP_201_CREATED,
    responses=NOT_YET,
)
async def create_node(
    call: CallerDep,
    paper_id: str,
    body: Annotated[NodeCreate, Depends(json_body(NodeCreate))],
) -> NodeCreated:
    raise not_implemented(SLICE)


@router.patch(
    "/boards/{board_id}/nodes/{node_id}",
    response_model=CanvasNode,
    responses={409: {"model": StaleVersion}, **NOT_YET},
)
async def patch_node(
    call: CallerDep,
    board_id: str,
    node_id: str,
    body: Annotated[NodePatch, Depends(json_body(NodePatch))],
) -> CanvasNode:
    raise not_implemented(SLICE)


@router.delete(
    "/boards/{board_id}/nodes/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=NOT_YET,
)
async def delete_node(call: CallerDep, board_id: str, node_id: str) -> Response:
    raise not_implemented(SLICE)


@router.post(
    "/boards/{board_id}/edges",
    response_model=CanvasEdge,
    status_code=status.HTTP_201_CREATED,
    responses=NOT_YET,
)
async def create_edge(
    call: CallerDep,
    board_id: str,
    body: Annotated[EdgeCreate, Depends(json_body(EdgeCreate))],
) -> CanvasEdge:
    raise not_implemented(SLICE)


@router.patch("/boards/{board_id}/edges/{edge_id}", response_model=CanvasEdge, responses=NOT_YET)
async def patch_edge(
    call: CallerDep,
    board_id: str,
    edge_id: str,
    body: Annotated[EdgePatch, Depends(json_body(EdgePatch))],
) -> CanvasEdge:
    raise not_implemented(SLICE)


@router.delete(
    "/boards/{board_id}/edges/{edge_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=NOT_YET,
)
async def delete_edge(call: CallerDep, board_id: str, edge_id: str) -> Response:
    raise not_implemented(SLICE)


@router.patch("/boards/{board_id}", response_model=Board, responses=NOT_YET)
async def patch_board(
    call: CallerDep,
    board_id: str,
    body: Annotated[BoardPatch, Depends(json_body(BoardPatch))],
) -> Board:
    raise not_implemented(SLICE)
