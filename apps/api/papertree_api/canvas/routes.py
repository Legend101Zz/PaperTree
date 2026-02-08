# apps/api/papertree_api/canvas/routes.py
import asyncio
import json
from datetime import datetime
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import (APIRouter, Depends, HTTPException, WebSocket,
                     WebSocketDisconnect)

from ..auth.utils import get_current_user
from ..database import get_database
from ..services.ai import get_ai_service
from .models import (AIQueryRequest, BatchExportRequest, BatchExportResponse,
                     BranchRequest, CanvasAIQueryRequest,
                     CanvasAIQueryResponse, CanvasCreate, CanvasEdge,
                     CanvasInDB, CanvasNode, CanvasNodeCreate, CanvasNodeInDB,
                     CanvasNodeUpdate, CanvasTemplateRequest, NodePosition)
from .services import (batch_export_highlights, canvas_ai_query,
                       create_template_canvas)

router = APIRouter(prefix="/canvas", tags=["canvas"])

# WebSocket connections for real-time updates
active_connections: Dict[str, List[WebSocket]] = {}


# ──── Canvas CRUD ────

@router.post("/", response_model=CanvasInDB)
async def create_canvas(
    canvas: CanvasCreate,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    now = datetime.utcnow()
    canvas_doc = {
        "user_id": str(user["_id"]),
        "book_id": canvas.book_id,
        "title": canvas.title,
        "nodes": [],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "created_at": now,
        "updated_at": now,
    }
    result = await db.canvases.insert_one(canvas_doc)
    canvas_doc["_id"] = str(result.inserted_id)
    return CanvasInDB(**canvas_doc)


@router.get("/book/{book_id}", response_model=List[CanvasInDB])
async def get_book_canvases(
    book_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    cursor = db.canvases.find({
        "user_id": str(user["_id"]),
        "book_id": book_id
    }).sort("updated_at", -1)
    canvases = await cursor.to_list(length=100)
    return [CanvasInDB(**{**c, "_id": str(c["_id"])}) for c in canvases]


@router.get("/{canvas_id}", response_model=CanvasInDB)
async def get_canvas(
    canvas_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    canvas = await db.canvases.find_one({
        "_id": ObjectId(canvas_id),
        "user_id": str(user["_id"])
    })
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")
    canvas["_id"] = str(canvas["_id"])
    return CanvasInDB(**canvas)


# ──── Node CRUD ────

@router.get("/{canvas_id}/nodes", response_model=List[CanvasNodeInDB])
async def get_canvas_nodes(
    canvas_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    cursor = db.canvas_nodes.find({
        "canvas_id": canvas_id,
        "user_id": str(user["_id"])
    })
    nodes = await cursor.to_list(length=1000)
    return [CanvasNodeInDB(**{**n, "_id": str(n["_id"])}) for n in nodes]


@router.post("/nodes", response_model=CanvasNodeInDB)
async def create_node(
    node: CanvasNodeCreate,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    canvas = await db.canvases.find_one({
        "_id": ObjectId(node.canvas_id),
        "user_id": str(user["_id"])
    })
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    now = datetime.utcnow()
    node_doc = {
        "canvas_id": node.canvas_id,
        "user_id": str(user["_id"]),
        "type": node.type,
        "position": node.position.dict(),
        "dimensions": {"width": 300, "height": 200},
        "title": node.title,
        "content": node.content,
        "data": node.data.dict() if node.data else None,
        "status": "idle",
        "highlight_id": node.highlight_id,
        "book_id": node.book_id,
        "page_number": node.page_number,
        "explanation_id": None,
        "ai_mode": node.ai_mode,
        "ai_model": node.ai_model,
        "ai_metadata": None,
        "parent_node_id": node.parent_node_id,
        "child_node_ids": [],
        "is_pinned": False,
        "is_collapsed": False,
        "created_at": now,
        "updated_at": now,
    }

    result = await db.canvas_nodes.insert_one(node_doc)
    node_id = str(result.inserted_id)
    node_doc["_id"] = node_id

    await db.canvases.update_one(
        {"_id": ObjectId(node.canvas_id)},
        {"$push": {"nodes": node_id}, "$set": {"updated_at": now}},
    )

    if node.parent_node_id:
        await db.canvas_nodes.update_one(
            {"_id": ObjectId(node.parent_node_id)},
            {"$push": {"child_node_ids": node_id}},
        )
        edge = CanvasEdge(
            id=f"{node.parent_node_id}-{node_id}",
            source_id=node.parent_node_id,
            target_id=node_id,
            edge_type="branch",
        )
        await db.canvases.update_one(
            {"_id": ObjectId(node.canvas_id)},
            {"$push": {"edges": edge.dict()}},
        )

    if node.highlight_id:
        await db.highlights.update_one(
            {"_id": ObjectId(node.highlight_id)},
            {"$set": {"canvas_node_id": node_id}},
        )

    return CanvasNodeInDB(**node_doc)


@router.patch("/nodes/{node_id}", response_model=CanvasNodeInDB)
async def update_node(
    node_id: str,
    update: CanvasNodeUpdate,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    update_data = {}
    if update.position:
        update_data["position"] = update.position.dict()
    if update.dimensions:
        update_data["dimensions"] = update.dimensions.dict()
    if update.title is not None:
        update_data["title"] = update.title
    if update.content is not None:
        update_data["content"] = update.content
    if update.data is not None:
        update_data["data"] = update.data
    if update.is_pinned is not None:
        update_data["is_pinned"] = update.is_pinned
    if update.is_collapsed is not None:
        update_data["is_collapsed"] = update.is_collapsed
    update_data["updated_at"] = datetime.utcnow()

    result = await db.canvas_nodes.find_one_and_update(
        {"_id": ObjectId(node_id), "user_id": str(user["_id"])},
        {"$set": update_data},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Node not found")
    result["_id"] = str(result["_id"])
    return CanvasNodeInDB(**result)


@router.delete("/nodes/{node_id}")
async def delete_node(
    node_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    node = await db.canvas_nodes.find_one({
        "_id": ObjectId(node_id),
        "user_id": str(user["_id"])
    })
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    async def delete_recursive(nid: str):
        n = await db.canvas_nodes.find_one({"_id": ObjectId(nid)})
        if n:
            for child_id in n.get("child_node_ids", []):
                await delete_recursive(child_id)
            await db.canvas_nodes.delete_one({"_id": ObjectId(nid)})

    await delete_recursive(node_id)

    await db.canvases.update_one(
        {"_id": ObjectId(node["canvas_id"])},
        {
            "$pull": {
                "nodes": node_id,
                "edges": {"$or": [{"source_id": node_id}, {"target_id": node_id}]},
            }
        },
    )

    if node.get("parent_node_id"):
        await db.canvas_nodes.update_one(
            {"_id": ObjectId(node["parent_node_id"])},
            {"$pull": {"child_node_ids": node_id}},
        )

    return {"deleted": True}


# ──── AI on nodes ────

@router.post("/nodes/{node_id}/ai", response_model=CanvasNodeInDB)
async def run_ai_query(
    node_id: str,
    request: AIQueryRequest,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    node = await db.canvas_nodes.find_one({
        "_id": ObjectId(node_id),
        "user_id": str(user["_id"])
    })
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    if node.get("status") == "loading":
        raise HTTPException(status_code=409, detail="Query already in progress")

    await db.canvas_nodes.update_one(
        {"_id": ObjectId(node_id)},
        {"$set": {"status": "loading"}},
    )

    try:
        context_parts = []
        for ctx_id in request.context_node_ids:
            ctx_node = await db.canvas_nodes.find_one({"_id": ObjectId(ctx_id)})
            if ctx_node and ctx_node.get("content"):
                context_parts.append(
                    f"[{ctx_node.get('title', 'Context')}]: {ctx_node['content'][:500]}"
                )
        context = "\n".join(context_parts)

        text = node.get("content", "")
        if not text and node.get("highlight_id"):
            highlight = await db.highlights.find_one(
                {"_id": ObjectId(node["highlight_id"])}
            )
            if highlight:
                text = highlight.get("text", "")

        ai = get_ai_service()
        result = await ai.generate(
            text=text,
            mode=request.mode,
            context=context,
            custom_prompt=request.custom_prompt,
            model=request.model,
        )

        update_doc = {
            "content": result["content"],
            "status": "complete",
            "ai_mode": request.mode,
            "ai_model": request.model,
            "ai_metadata": {
                "model_name": result["model_name"],
                "tokens_used": result["tokens_used"],
                "cost_estimate": result["cost_estimate"],
            },
            "updated_at": datetime.utcnow(),
        }

        updated = await db.canvas_nodes.find_one_and_update(
            {"_id": ObjectId(node_id)},
            {"$set": update_doc},
            return_document=True,
        )
        updated["_id"] = str(updated["_id"])
        return CanvasNodeInDB(**updated)

    except Exception as e:
        await db.canvas_nodes.update_one(
            {"_id": ObjectId(node_id)},
            {"$set": {"status": "error"}},
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nodes/{node_id}/branch", response_model=CanvasNodeInDB)
async def create_branch(
    node_id: str,
    request: BranchRequest,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    parent = await db.canvas_nodes.find_one({
        "_id": ObjectId(node_id),
        "user_id": str(user["_id"])
    })
    if not parent:
        raise HTTPException(status_code=404, detail="Parent node not found")

    num_children = len(parent.get("child_node_ids", []))
    new_position = NodePosition(
        x=parent["position"]["x"] + request.position_offset.x,
        y=parent["position"]["y"] + request.position_offset.y + (num_children * 250),
    )

    branch_titles = {
        "question": "❓ Question",
        "critique": "🔍 Critique",
        "expand": "📖 Expand",
        "related": "🔗 Related",
        "custom": "💭 Custom",
    }

    new_node = CanvasNodeCreate(
        canvas_id=parent["canvas_id"],
        type="ai_response",
        position=new_position,
        title=branch_titles.get(request.branch_type, "Branch"),
        content=None,
        book_id=parent.get("book_id"),
        ai_mode=request.branch_type if request.branch_type != "custom" else "explain",
        parent_node_id=node_id,
    )

    created = await create_node(new_node, user=user, db=db)

    ai_request = AIQueryRequest(
        node_id=created.id,
        mode=request.branch_type if request.branch_type != "custom" else "explain",
        context_node_ids=[node_id],
        custom_prompt=request.custom_prompt,
    )

    return await run_ai_query(created.id, ai_request, user=user, db=db)


# ──── Highlight → Canvas ────

@router.post("/from-highlight")
async def create_canvas_from_highlight(
    highlight_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    highlight = await db.highlights.find_one({
        "_id": ObjectId(highlight_id),
        "user_id": str(user["_id"])
    })
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")

    canvas = await db.canvases.find_one({
        "book_id": highlight["book_id"],
        "user_id": str(user["_id"])
    })

    if not canvas:
        canvas_create = CanvasCreate(
            book_id=highlight["book_id"],
            title="Research Canvas",
        )
        canvas = await create_canvas(canvas_create, user=user, db=db)
        canvas_id = canvas.id
    else:
        canvas_id = str(canvas["_id"])

    node = CanvasNodeCreate(
        canvas_id=canvas_id,
        type="highlight",
        position=NodePosition(x=100, y=100),
        title=f"📝 Page {highlight['position']['page_number'] + 1}",
        content=highlight["text"],
        highlight_id=highlight_id,
        book_id=highlight["book_id"],
        page_number=highlight["position"]["page_number"],
    )

    created_node = await create_node(node, user=user, db=db)
    return {"canvas_id": canvas_id, "node": created_node}


@router.post("/{canvas_id}/auto-summary")
async def generate_auto_summary(
    canvas_id: str,
    user=Depends(get_current_user),
    db=Depends(get_database),
):
    canvas = await db.canvases.find_one({
        "_id": ObjectId(canvas_id),
        "user_id": str(user["_id"])
    })
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    book = await db.books.find_one({"_id": ObjectId(canvas["book_id"])})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    abstract = ""
    if "pages" in book and len(book["pages"]) > 0:
        abstract = " ".join([p.get("text", "")[:1000] for p in book["pages"][:3]])

    node = CanvasNodeCreate(
        canvas_id=canvas_id,
        type="summary",
        position=NodePosition(x=400, y=100),
        title="📄 Paper Summary",
        content=None,
        book_id=canvas["book_id"],
        ai_mode="summarize",
    )

    created = await create_node(node, user=user, db=db)

    ai = get_ai_service()
    result = await ai.generate(
        text=abstract,
        mode="summarize",
        context=f"Title: {book.get('title', 'Unknown')}",
    )

    updated = await db.canvas_nodes.find_one_and_update(
        {"_id": ObjectId(created.id)},
        {
            "$set": {
                "content": result["content"],
                "status": "complete",
                "ai_metadata": {
                    "model_name": result["model_name"],
                    "tokens_used": result["tokens_used"],
                },
                "updated_at": datetime.utcnow(),
            }
        },
        return_document=True,
    )
    updated["_id"] = str(updated["_id"])
    return CanvasNodeInDB(**updated)

# ──── Paper-based canvas router (NO prefix — resolves to /papers/...) ────
paper_canvas_router = APIRouter(tags=["paper-canvas"])


async def _get_or_create_paper_canvas(paper_id: str, user_id: str) -> dict:
    db = get_database()
    canvas = await db.canvases.find_one({"paper_id": paper_id, "user_id": user_id})
    if not canvas:
        paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
        paper_title = paper["title"] if paper else "Paper"
        now = datetime.utcnow()
        doc = {
            "paper_id": paper_id,
            "user_id": user_id,
            "elements": {
                "nodes": [{
                    "id": f"paper-{paper_id}",
                    "type": "paper",
                    "position": {"x": 400, "y": 50},
                    "data": {
                        "label": paper_title, "content": None,
                        "content_type": "plain", "is_collapsed": False,
                        "tags": [], "created_at": now.isoformat(),
                    },
                    "parent_id": None, "children_ids": [],
                }],
                "edges": [],
            },
            "updated_at": now,
        }
        result = await db.canvases.insert_one(doc)
        doc["_id"] = result.inserted_id
        canvas = doc
    return canvas


@paper_canvas_router.get("/papers/{paper_id}/canvas")
async def get_paper_canvas(paper_id: str, current_user: dict = Depends(get_current_user)):
    db = get_database()
    paper = await db.papers.find_one({"_id": ObjectId(paper_id), "user_id": current_user["id"]})
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    canvas = await _get_or_create_paper_canvas(paper_id, current_user["id"])
    updated = canvas.get("updated_at", datetime.utcnow())
    return {
        "id": str(canvas["_id"]),
        "paper_id": paper_id,
        "user_id": current_user["id"],
        "elements": canvas["elements"],
        "updated_at": updated.isoformat() if isinstance(updated, datetime) else updated,
    }


@paper_canvas_router.put("/papers/{paper_id}/canvas")
async def update_paper_canvas(paper_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    db = get_database()
    canvas = await _get_or_create_paper_canvas(paper_id, current_user["id"])
    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {"$set": {"elements": body.get("elements", {}), "updated_at": datetime.utcnow()}},
    )
    return {"status": "ok"}


@paper_canvas_router.post("/papers/{paper_id}/canvas/nodes")
async def create_paper_canvas_node(paper_id: str, node_data: dict, current_user: dict = Depends(get_current_user)):
    import uuid as _uuid
    db = get_database()
    canvas = await _get_or_create_paper_canvas(paper_id, current_user["id"])
    nodes = canvas["elements"]["nodes"]
    node_id = f"node_{_uuid.uuid4().hex[:12]}"
    now = datetime.utcnow()
    data = node_data.get("data", {})
    data["created_at"] = now.isoformat()
    data["updated_at"] = now.isoformat()
    new_node = {
        "id": node_id,
        "type": node_data.get("type", "note"),
        "position": node_data.get("position", {"x": 400, "y": 200}),
        "data": data,
        "parent_id": node_data.get("parent_id"),
        "children_ids": [],
    }
    nodes.append(new_node)
    if new_node["parent_id"]:
        for n in nodes:
            if n["id"] == new_node["parent_id"]:
                n.setdefault("children_ids", []).append(node_id)
                break
    await db.canvases.update_one({"_id": canvas["_id"]}, {"$set": {"elements.nodes": nodes, "updated_at": now}})
    return new_node


@paper_canvas_router.post("/papers/{paper_id}/canvas/auto-create")
async def auto_create_paper_node(paper_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    import uuid as _uuid
    db = get_database()
    canvas = await _get_or_create_paper_canvas(paper_id, current_user["id"])
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]
    now = datetime.utcnow()
    highlight_id = body.get("highlight_id")
    explanation_id = body.get("explanation_id")
    highlight = await db.highlights.find_one({"_id": ObjectId(highlight_id)}) if highlight_id else None
    explanation = await db.explanations.find_one({"_id": ObjectId(explanation_id)}) if explanation_id else None
    node_id = f"node_{_uuid.uuid4().hex[:12]}"
    paper_node_id = next((n["id"] for n in nodes if n.get("type") == "paper"), None)
    pos = body.get("position", {"x": 200 + len(nodes) * 50, "y": 250})
    new_node = {
        "id": node_id, "type": "answer", "position": pos,
        "data": {
            "label": f"AI: {(explanation or {}).get('question', '')[:40]}",
            "content": (explanation or {}).get("answer_markdown", ""),
            "content_type": "markdown",
            "highlight_id": highlight_id, "explanation_id": explanation_id,
            "question": (explanation or {}).get("question"),
            "ask_mode": (explanation or {}).get("ask_mode"),
            "source": {"paper_id": paper_id, "highlight_id": highlight_id},
            "is_collapsed": False, "tags": [],
            "created_at": now.isoformat(), "updated_at": now.isoformat(),
        },
        "parent_id": paper_node_id, "children_ids": [],
    }
    nodes.append(new_node)
    if paper_node_id:
        for n in nodes:
            if n["id"] == paper_node_id:
                n.setdefault("children_ids", []).append(node_id)
                break
        edges.append({"id": f"edge_{_uuid.uuid4().hex[:12]}", "source_id": paper_node_id, "target_id": node_id, "edge_type": "followup"})
    await db.canvases.update_one({"_id": canvas["_id"]}, {"$set": {"elements.nodes": nodes, "elements.edges": edges, "updated_at": now}})
    if explanation_id:
        await db.explanations.update_one({"_id": ObjectId(explanation_id)}, {"$set": {"canvas_node_id": node_id}})
    return new_node


@paper_canvas_router.post("/papers/{paper_id}/canvas/layout")
async def layout_paper_canvas(paper_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    db = get_database()
    canvas = await _get_or_create_paper_canvas(paper_id, current_user["id"])
    nodes = canvas["elements"]["nodes"]
    algo = body.get("algorithm", "tree")
    if algo == "grid":
        for i, n in enumerate(nodes):
            n["position"] = {"x": 100 + (i % 3) * 350, "y": 50 + (i // 3) * 250}
    else:
        roots = [n for n in nodes if not n.get("parent_id")]
        y = 50
        for root in roots:
            root["position"] = {"x": 400, "y": y}
            children = [n for n in nodes if n.get("parent_id") == root["id"]]
            for j, c in enumerate(children):
                c["position"] = {"x": 100 + j * 320, "y": y + 220}
            y += 500
    await db.canvases.update_one({"_id": canvas["_id"]}, {"$set": {"elements.nodes": nodes, "updated_at": datetime.utcnow()}})
    return {"status": "ok"}


@paper_canvas_router.post("/papers/{paper_id}/canvas/batch-export", response_model=BatchExportResponse)
async def paper_batch_export(paper_id: str, request: BatchExportRequest, current_user: dict = Depends(get_current_user)):
    db = get_database()
    paper = await db.papers.find_one({"_id": ObjectId(paper_id), "user_id": current_user["id"]})
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    new_nodes, new_edges = await batch_export_highlights(
        paper_id=paper_id, user_id=current_user["id"],
        highlight_ids=request.highlight_ids, include_explanations=request.include_explanations, layout=request.layout,
    )
    return BatchExportResponse(nodes_created=len(new_nodes), edges_created=len(new_edges), root_node_ids=[n["id"] for n in new_nodes if n.get("type") == "excerpt"])


@paper_canvas_router.post("/papers/{paper_id}/canvas/ai-query", response_model=CanvasAIQueryResponse)
async def paper_ai_query(paper_id: str, request: CanvasAIQueryRequest, current_user: dict = Depends(get_current_user)):
    try:
        new_node, new_edge = await canvas_ai_query(
            paper_id=paper_id, user_id=current_user["id"],
            parent_node_id=request.parent_node_id, question=request.question,
            ask_mode=request.ask_mode.value, include_paper_context=request.include_paper_context,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI query failed: {str(e)}")
    return CanvasAIQueryResponse(node=CanvasNode(**new_node), edge=CanvasEdge(**new_edge))


@paper_canvas_router.post("/papers/{paper_id}/canvas/template")
async def paper_canvas_template(paper_id: str, request: CanvasTemplateRequest, current_user: dict = Depends(get_current_user)):
    db = get_database()
    paper = await db.papers.find_one({"_id": ObjectId(paper_id), "user_id": current_user["id"]})
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    new_nodes = await create_template_canvas(paper_id=paper_id, user_id=current_user["id"], template=request.template)
    return {"nodes_created": len(new_nodes), "template": request.template}


# ──── WebSocket ────

@router.websocket("/ws/{canvas_id}")
async def canvas_websocket(websocket: WebSocket, canvas_id: str):
    await websocket.accept()
    if canvas_id not in active_connections:
        active_connections[canvas_id] = []
    active_connections[canvas_id].append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            for connection in active_connections[canvas_id]:
                if connection != websocket:
                    await connection.send_text(json.dumps(message))
    except WebSocketDisconnect:
        active_connections[canvas_id].remove(websocket)