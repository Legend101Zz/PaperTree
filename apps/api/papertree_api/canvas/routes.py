# apps/api/papertree_api/canvas/routes.py
"""
Canvas routes — Maxly-style exploration canvas.

Routes under /papers/{paper_id}/canvas/* (paper_canvas_router)
are the primary canvas API. The old /canvas/* routes are kept
for backwards compatibility but deprecated.
"""
import uuid as _uuid
from datetime import datetime
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from ..auth.utils import get_current_user
from ..database import get_database
from .models import (AddNoteRequest, AskFollowupRequest, AskFollowupResponse,
                     BatchExportRequest, BatchExportResponse, CanvasElements,
                     CanvasResponse, ExpandPageRequest, ExploreRequest,
                     ExploreResponse, NodePosition)
from .services import (add_note, ask_followup, create_exploration,
                       ensure_page_super_node, get_or_create_canvas)

# ──── Primary router: /papers/{paper_id}/canvas/* ────
paper_canvas_router = APIRouter(tags=["paper-canvas"])


@paper_canvas_router.get("/papers/{paper_id}/canvas")
async def get_paper_canvas(
    paper_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get or create the canvas for a paper."""
    db = get_database()
    paper = await db.papers.find_one({
        "_id": ObjectId(paper_id), "user_id": current_user["id"]
    })
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    updated = canvas.get("updated_at", datetime.utcnow())
    return {
        "id": str(canvas["_id"]),
        "paper_id": paper_id,
        "user_id": current_user["id"],
        "elements": canvas["elements"],
        "updated_at": updated.isoformat() if isinstance(updated, datetime) else updated,
    }


@paper_canvas_router.put("/papers/{paper_id}/canvas")
async def update_paper_canvas(
    paper_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Full save of canvas elements (from ReactFlow)."""
    db = get_database()
    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {"$set": {
            "elements": body.get("elements", {}),
            "updated_at": datetime.utcnow(),
        }},
    )
    return {"status": "ok"}


# ──── Explore: Highlight → Canvas Branch ────

@paper_canvas_router.post("/papers/{paper_id}/canvas/explore")
async def explore_highlight(
    paper_id: str,
    request: ExploreRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Main action: highlight text → jump to canvas with AI explanation branch.
    Creates page super-node (if needed) → exploration node → AI response node.
    """
    db = get_database()
    paper = await db.papers.find_one({
        "_id": ObjectId(paper_id), "user_id": current_user["id"]
    })
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    try:
        result = await create_exploration(
            paper_id=paper_id,
            user_id=current_user["id"],
            highlight_id=request.highlight_id,
            question=request.question,
            ask_mode=request.ask_mode.value,
            page_number=request.page_number,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return result


# ──── Ask Follow-up ────

@paper_canvas_router.post("/papers/{paper_id}/canvas/ask")
async def ask_followup_route(
    paper_id: str,
    request: AskFollowupRequest,
    current_user: dict = Depends(get_current_user),
):
    """Branch a follow-up question from any node."""
    import traceback

    db = get_database()
    paper = await db.papers.find_one({
        "_id": ObjectId(paper_id), "user_id": current_user["id"]
    })
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    try:
        result = await ask_followup(
            paper_id=paper_id,
            user_id=current_user["id"],
            parent_node_id=request.parent_node_id,
            question=request.question,
            ask_mode=request.ask_mode.value,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        traceback.print_exc()  # This prints the full stack trace to terminal
        raise HTTPException(status_code=500, detail=f"AI query failed: {str(e)}")

    return result


# ──── Notes ────

@paper_canvas_router.post("/papers/{paper_id}/canvas/note")
async def add_note_route(
    paper_id: str,
    request: AddNoteRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add a user note to the canvas."""
    return await add_note(
        paper_id=paper_id,
        user_id=current_user["id"],
        content=request.content,
        parent_node_id=request.parent_node_id,
        position=request.position.dict() if request.position else None,
    )


# ──── Page expansion ────

@paper_canvas_router.post("/papers/{paper_id}/canvas/expand-page")
async def expand_page(
    paper_id: str,
    request: ExpandPageRequest,
    current_user: dict = Depends(get_current_user),
):
    """Ensure a page super-node exists and return it."""
    canvas, page_node, was_created = await ensure_page_super_node(
        paper_id, current_user["id"], request.page_number,
    )
    return {
        "page_node": page_node,
        "was_created": was_created,
        "canvas_id": str(canvas["_id"]),
    }


# ──── Auto-layout ────

@paper_canvas_router.post("/papers/{paper_id}/canvas/layout")
async def layout_paper_canvas(
    paper_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Auto-layout nodes in a tree or grid pattern."""
    db = get_database()
    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    nodes = canvas["elements"]["nodes"]
    algo = body.get("algorithm", "tree")

    if algo == "grid":
        for i, n in enumerate(nodes):
            n["position"] = {"x": 100 + (i % 4) * 380, "y": 50 + (i // 4) * 280}
    else:
        # Tree layout: paper at top, pages below, explorations/responses below those
        _tree_layout(nodes)

    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {"$set": {"elements.nodes": nodes, "updated_at": datetime.utcnow()}},
    )
    return {"status": "ok"}


def _tree_layout(nodes: list):
    """Simple tree layout algorithm."""
    from collections import defaultdict

    children_map = defaultdict(list)
    for n in nodes:
        pid = n.get("parent_id")
        if pid:
            children_map[pid].append(n["id"])

    roots = [n for n in nodes if not n.get("parent_id")]
    node_map = {n["id"]: n for n in nodes}

    def layout_subtree(nid: str, x: float, y: float, h_space: float) -> float:
        node = node_map.get(nid)
        if not node:
            return x

        kids = children_map.get(nid, [])
        if not kids:
            node["position"] = {"x": x, "y": y}
            return x + h_space

        # Layout children first to get total width
        child_start = x
        for kid_id in kids:
            child_start = layout_subtree(kid_id, child_start, y + 250, h_space)

        # Center parent above children
        first_kid = node_map.get(kids[0])
        last_kid = node_map.get(kids[-1])
        if first_kid and last_kid:
            center_x = (first_kid["position"]["x"] + last_kid["position"]["x"]) / 2
        else:
            center_x = x

        node["position"] = {"x": center_x, "y": y}
        return max(child_start, x + h_space)

    x_cursor = 50.0
    for root in roots:
        x_cursor = layout_subtree(root["id"], x_cursor, 50, 350)
        x_cursor += 100


# ──── Delete node (recursive) ────

@paper_canvas_router.delete("/papers/{paper_id}/canvas/nodes/{node_id}")
async def delete_canvas_node(
    paper_id: str,
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a node and all its descendants."""
    db = get_database()
    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]

    # Collect all descendant IDs
    to_delete = set()

    def collect(nid: str):
        to_delete.add(nid)
        for n in nodes:
            if n.get("parent_id") == nid:
                collect(n["id"])

    collect(node_id)

    # Remove from parent's children_ids
    target_node = _find_node(nodes, node_id)
    if target_node and target_node.get("parent_id"):
        parent = _find_node(nodes, target_node["parent_id"])
        if parent and "children_ids" in parent:
            parent["children_ids"] = [
                c for c in parent["children_ids"] if c not in to_delete
            ]

    # Filter out deleted nodes and edges
    new_nodes = [n for n in nodes if n["id"] not in to_delete]
    new_edges = [
        e for e in edges
        if e.get("source") not in to_delete and e.get("target") not in to_delete
    ]

    await _save_canvas(canvas["_id"], new_nodes, new_edges)
    return {"deleted": list(to_delete)}


def _find_node(nodes, node_id):
    for n in nodes:
        if n["id"] == node_id:
            return n
    return None


async def _save_canvas(canvas_id, nodes, edges):
    db = get_database()
    await db.canvases.update_one(
        {"_id": canvas_id},
        {"$set": {
            "elements.nodes": nodes,
            "elements.edges": edges,
            "updated_at": datetime.utcnow(),
        }},
    )


# ──── Update single node (position, content, collapse) ────

@paper_canvas_router.patch("/papers/{paper_id}/canvas/nodes/{node_id}")
async def update_canvas_node(
    paper_id: str,
    node_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update a single node's properties without full canvas save."""
    db = get_database()
    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    nodes = canvas["elements"]["nodes"]

    node = _find_node(nodes, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Apply updates
    if "position" in body:
        node["position"] = body["position"]
    if "data" in body:
        node["data"] = {**node.get("data", {}), **body["data"]}

    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {"$set": {"elements.nodes": nodes, "updated_at": datetime.utcnow()}},
    )
    return node


# ──── Keep old router for backward compat (deprecated) ────
router = APIRouter(prefix="/canvas", tags=["canvas-legacy"])


@router.get("/health")
async def canvas_health():
    return {"status": "ok", "note": "Use /papers/{paper_id}/canvas/* routes instead"}