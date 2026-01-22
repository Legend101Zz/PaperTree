# apps/api/papertree_api/canvas/routes.py
import uuid
from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from papertree_api.auth.utils import get_current_user
from papertree_api.database import get_database

from .models import (AskMode, AutoCreateNodeRequest, CanvasEdge,
                     CanvasElements, CanvasNode, CanvasNodeCreate,
                     CanvasNodeData, CanvasNodePosition, CanvasNodeUpdate,
                     CanvasResponse, CanvasUpdate, ContentType, ExcerptContext,
                     NodeLayoutRequest, NodeType, SourceReference)

router = APIRouter()


def generate_node_id() -> str:
    """Generate unique node ID."""
    return f"node_{uuid.uuid4().hex[:12]}"


def generate_edge_id() -> str:
    """Generate unique edge ID."""
    return f"edge_{uuid.uuid4().hex[:12]}"


async def get_or_create_canvas(paper_id: str, user_id: str) -> dict:
    """Get existing canvas or create new one."""
    db = get_database()
    
    canvas = await db.canvases.find_one({
        "paper_id": paper_id,
        "user_id": user_id
    })
    
    if not canvas:
        # Create new canvas with paper node
        paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
        paper_title = paper["title"] if paper else "Paper"
        
        paper_node = {
            "id": f"paper-{paper_id}",
            "type": NodeType.PAPER.value,
            "position": {"x": 400, "y": 50},
            "data": {
                "label": paper_title,
                "content": None,
                "content_type": ContentType.PLAIN.value,
                "is_collapsed": False,
                "tags": [],
                "created_at": datetime.utcnow().isoformat(),
            },
            "parent_id": None,
            "children_ids": []
        }
        
        canvas_doc = {
            "paper_id": paper_id,
            "user_id": user_id,
            "elements": {
                "nodes": [paper_node],
                "edges": []
            },
            "updated_at": datetime.utcnow()
        }
        
        result = await db.canvases.insert_one(canvas_doc)
        canvas = canvas_doc
        canvas["_id"] = result.inserted_id
    
    return canvas


def calculate_next_position(nodes: List[dict], parent_id: Optional[str] = None) -> dict:
    """Calculate position for a new node."""
    if not nodes:
        return {"x": 400, "y": 200}
    
    if parent_id:
        # Find parent and position below it
        parent = next((n for n in nodes if n["id"] == parent_id), None)
        if parent:
            # Find siblings
            siblings = [n for n in nodes if n.get("parent_id") == parent_id]
            x_offset = len(siblings) * 300
            return {
                "x": parent["position"]["x"] + x_offset,
                "y": parent["position"]["y"] + 200
            }
    
    # Find rightmost bottom node
    max_y = max(n["position"]["y"] for n in nodes)
    bottom_nodes = [n for n in nodes if n["position"]["y"] == max_y]
    max_x = max(n["position"]["x"] for n in bottom_nodes)
    
    return {"x": max_x + 350, "y": max_y}


@router.get("/papers/{paper_id}/canvas", response_model=CanvasResponse)
async def get_canvas(
    paper_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get canvas for a paper. Creates one if it doesn't exist."""
    db = get_database()
    
    # Verify paper exists
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    
    return CanvasResponse(
        id=str(canvas["_id"]),
        paper_id=canvas["paper_id"],
        user_id=canvas["user_id"],
        elements=CanvasElements(**canvas["elements"]),
        updated_at=canvas["updated_at"]
    )


@router.put("/papers/{paper_id}/canvas", response_model=CanvasResponse)
async def update_canvas(
    paper_id: str,
    canvas_data: CanvasUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update entire canvas."""
    db = get_database()
    
    # Verify paper exists
    try:
        paper = await db.papers.find_one({
            "_id": ObjectId(paper_id),
            "user_id": current_user["id"]
        })
    except:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    now = datetime.utcnow()
    
    # Convert to dict for storage
    elements_dict = {
        "nodes": [n.dict() if hasattr(n, 'dict') else n for n in canvas_data.elements.nodes],
        "edges": [e.dict() if hasattr(e, 'dict') else e for e in canvas_data.elements.edges]
    }
    
    result = await db.canvases.find_one_and_update(
        {
            "paper_id": paper_id,
            "user_id": current_user["id"]
        },
        {
            "$set": {
                "elements": elements_dict,
                "updated_at": now
            },
            "$setOnInsert": {
                "paper_id": paper_id,
                "user_id": current_user["id"]
            }
        },
        upsert=True,
        return_document=True
    )
    
    return CanvasResponse(
        id=str(result["_id"]),
        paper_id=result["paper_id"],
        user_id=result["user_id"],
        elements=CanvasElements(**result["elements"]),
        updated_at=result["updated_at"]
    )


@router.post("/papers/{paper_id}/canvas/nodes", response_model=CanvasNode)
async def create_node(
    paper_id: str,
    node_data: CanvasNodeCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a single canvas node."""
    db = get_database()
    
    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    
    node_id = generate_node_id()
    now = datetime.utcnow()
    
    # Build node data
    data_dict = node_data.data.dict() if hasattr(node_data.data, 'dict') else dict(node_data.data)
    data_dict["created_at"] = now.isoformat()
    data_dict["updated_at"] = now.isoformat()
    
    new_node = {
        "id": node_id,
        "type": node_data.type.value,
        "position": node_data.position.dict(),
        "data": data_dict,
        "parent_id": node_data.parent_id,
        "children_ids": []
    }
    
    # Update parent's children_ids
    nodes = canvas["elements"]["nodes"]
    if node_data.parent_id:
        for i, n in enumerate(nodes):
            if n["id"] == node_data.parent_id:
                if "children_ids" not in n:
                    n["children_ids"] = []
                n["children_ids"].append(node_id)
                break
    
    nodes.append(new_node)
    
    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {
            "$set": {
                "elements.nodes": nodes,
                "updated_at": now
            }
        }
    )
    
    return CanvasNode(**new_node)


@router.patch("/papers/{paper_id}/canvas/nodes/{node_id}", response_model=CanvasNode)
async def update_node(
    paper_id: str,
    node_id: str,
    update_data: CanvasNodeUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update a canvas node."""
    db = get_database()
    
    canvas = await db.canvases.find_one({
        "paper_id": paper_id,
        "user_id": current_user["id"]
    })
    
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")
    
    nodes = canvas["elements"]["nodes"]
    node_index = next((i for i, n in enumerate(nodes) if n["id"] == node_id), None)
    
    if node_index is None:
        raise HTTPException(status_code=404, detail="Node not found")
    
    node = nodes[node_index]
    now = datetime.utcnow()
    
    if update_data.position:
        node["position"] = update_data.position.dict()
    
    if update_data.data:
        node["data"].update(update_data.data)
        node["data"]["updated_at"] = now.isoformat()
    
    if update_data.is_collapsed is not None:
        node["data"]["is_collapsed"] = update_data.is_collapsed
    
    nodes[node_index] = node
    
    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {
            "$set": {
                "elements.nodes": nodes,
                "updated_at": now
            }
        }
    )
    
    return CanvasNode(**node)


@router.delete("/papers/{paper_id}/canvas/nodes/{node_id}")
async def delete_node(
    paper_id: str,
    node_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a canvas node and its children."""
    db = get_database()
    
    canvas = await db.canvases.find_one({
        "paper_id": paper_id,
        "user_id": current_user["id"]
    })
    
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")
    
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]
    
    # Find all nodes to delete (node + all descendants)
    def collect_descendants(nid: str) -> List[str]:
        ids = [nid]
        for n in nodes:
            if n.get("parent_id") == nid:
                ids.extend(collect_descendants(n["id"]))
        return ids
    
    ids_to_delete = set(collect_descendants(node_id))
    
    # Filter out deleted nodes
    new_nodes = [n for n in nodes if n["id"] not in ids_to_delete]
    
    # Filter out edges connected to deleted nodes
    new_edges = [e for e in edges if e["source"] not in ids_to_delete and e["target"] not in ids_to_delete]
    
    # Update parent's children_ids
    deleted_node = next((n for n in nodes if n["id"] == node_id), None)
    if deleted_node and deleted_node.get("parent_id"):
        for n in new_nodes:
            if n["id"] == deleted_node["parent_id"] and "children_ids" in n:
                n["children_ids"] = [cid for cid in n["children_ids"] if cid != node_id]
    
    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {
            "$set": {
                "elements.nodes": new_nodes,
                "elements.edges": new_edges,
                "updated_at": datetime.utcnow()
            }
        }
    )
    
    return {"message": f"Deleted {len(ids_to_delete)} node(s)"}


@router.post("/papers/{paper_id}/canvas/auto-create", response_model=CanvasNode)
async def auto_create_node_from_explanation(
    paper_id: str,
    request: AutoCreateNodeRequest,
    current_user: dict = Depends(get_current_user)
):
    """Auto-create a canvas node from a highlight and explanation."""
    db = get_database()
    
    # Get highlight
    highlight = await db.highlights.find_one({
        "_id": ObjectId(request.highlight_id),
        "user_id": current_user["id"]
    })
    
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    
    # Get explanation
    explanation = await db.explanations.find_one({
        "_id": ObjectId(request.explanation_id),
        "user_id": current_user["id"]
    })
    
    if not explanation:
        raise HTTPException(status_code=404, detail="Explanation not found")
    
    # Get canvas
    canvas = await get_or_create_canvas(paper_id, current_user["id"])
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]
    
    # Check if node already exists for this explanation
    existing = next((n for n in nodes if n["data"].get("explanation_id") == request.explanation_id), None)
    if existing:
        return CanvasNode(**existing)
    
    now = datetime.utcnow()
    
    # Determine node type based on whether this is a follow-up
    is_followup = explanation.get("parent_id") is not None
    node_type = NodeType.FOLLOWUP if is_followup else NodeType.ANSWER
    
    # Find parent node if this is a follow-up
    parent_node_id = None
    if is_followup:
        parent_exp_id = explanation["parent_id"]
        parent_node = next((n for n in nodes if n["data"].get("explanation_id") == parent_exp_id), None)
        if parent_node:
            parent_node_id = parent_node["id"]
    else:
        # Find or create excerpt node for the highlight
        excerpt_node = next((n for n in nodes if n["data"].get("highlight_id") == request.highlight_id and n["type"] == NodeType.EXCERPT.value), None)
        
        if not excerpt_node:
            # Create excerpt node first
            excerpt_id = generate_node_id()
            
            # Get expanded excerpt
            from papertree_api.services.excerpt_service import \
                extract_intelligent_excerpt
            
            paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
            excerpt_context = await extract_intelligent_excerpt(
                paper.get("extracted_text", ""),
                highlight["selected_text"],
                paper.get("book_content"),
                highlight.get("section_id")
            )
            
            excerpt_position = request.position.dict() if request.position else calculate_next_position(nodes, f"paper-{paper_id}")
            
            excerpt_node = {
                "id": excerpt_id,
                "type": NodeType.EXCERPT.value,
                "position": excerpt_position,
                "data": {
                    "label": "Excerpt",
                    "content": excerpt_context.get("expanded_text", highlight["selected_text"]),
                    "content_type": ContentType.MARKDOWN.value,
                    "excerpt": excerpt_context,
                    "highlight_id": request.highlight_id,
                    "source": {
                        "paper_id": paper_id,
                        "page_number": highlight.get("page_number"),
                        "section_id": highlight.get("section_id"),
                        "section_path": excerpt_context.get("section_path", []),
                        "highlight_id": request.highlight_id,
                    },
                    "is_collapsed": False,
                    "tags": [],
                    "created_at": now.isoformat(),
                    "updated_at": now.isoformat(),
                },
                "parent_id": f"paper-{paper_id}",
                "children_ids": []
            }
            
            nodes.append(excerpt_node)
            
            # Add edge from paper to excerpt
            edges.append({
                "id": generate_edge_id(),
                "source": f"paper-{paper_id}",
                "target": excerpt_id,
                "edge_type": "default"
            })
            
            # Update paper node's children
            paper_node = next((n for n in nodes if n["id"] == f"paper-{paper_id}"), None)
            if paper_node:
                if "children_ids" not in paper_node:
                    paper_node["children_ids"] = []
                paper_node["children_ids"].append(excerpt_id)
        
        parent_node_id = excerpt_node["id"]
    
    # Determine content type from answer
    answer_content = explanation.get("answer_markdown", "")
    content_type = ContentType.MARKDOWN
    
    if "```mermaid" in answer_content:
        content_type = ContentType.MERMAID
    elif "$$" in answer_content or "$" in answer_content:
        content_type = ContentType.MIXED
    
    # Calculate position
    if request.position:
        position = request.position.dict()
    else:
        position = calculate_next_position(nodes, parent_node_id)
    
    # Create answer node
    node_id = generate_node_id()
    
    ask_mode = explanation.get("ask_mode", AskMode.EXPLAIN_SIMPLY.value)
    
    new_node = {
        "id": node_id,
        "type": node_type.value,
        "position": position,
        "data": {
            "label": explanation["question"][:50] + ("..." if len(explanation["question"]) > 50 else ""),
            "content": answer_content,
            "content_type": content_type.value,
            "question": explanation["question"],
            "ask_mode": ask_mode,
            "explanation_id": request.explanation_id,
            "highlight_id": request.highlight_id,
            "source": {
                "paper_id": paper_id,
                "page_number": highlight.get("page_number"),
                "section_id": highlight.get("section_id"),
                "highlight_id": request.highlight_id,
            },
            "is_collapsed": False,
            "tags": [ask_mode],
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        "parent_id": parent_node_id,
        "children_ids": []
    }
    
    nodes.append(new_node)
    
    # Add edge
    if parent_node_id:
        edge_type = "followup" if is_followup else "default"
        edges.append({
            "id": generate_edge_id(),
            "source": parent_node_id,
            "target": node_id,
            "edge_type": edge_type
        })
        
        # Update parent's children
        for n in nodes:
            if n["id"] == parent_node_id:
                if "children_ids" not in n:
                    n["children_ids"] = []
                n["children_ids"].append(node_id)
                break
    
    # Save canvas
    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {
            "$set": {
                "elements.nodes": nodes,
                "elements.edges": edges,
                "updated_at": now
            }
        }
    )
    
    return CanvasNode(**new_node)


@router.post("/papers/{paper_id}/canvas/layout")
async def auto_layout_nodes(
    paper_id: str,
    request: NodeLayoutRequest,
    current_user: dict = Depends(get_current_user)
):
    """Auto-layout canvas nodes using specified algorithm."""
    db = get_database()
    
    canvas = await db.canvases.find_one({
        "paper_id": paper_id,
        "user_id": current_user["id"]
    })
    
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")
    
    nodes = canvas["elements"]["nodes"]
    
    if request.algorithm == "tree":
        # Simple tree layout
        root_id = request.root_node_id or f"paper-{paper_id}"
        
        def layout_tree(node_id: str, x: float, y: float, level: int = 0) -> float:
            """Layout tree recursively, returns width used."""
            node = next((n for n in nodes if n["id"] == node_id), None)
            if not node:
                return 0
            
            children_ids = node.get("children_ids", [])
            
            if not children_ids:
                node["position"] = {"x": x, "y": y}
                return 300  # Node width + padding
            
            # Layout children first to calculate total width
            total_width = 0
            child_positions = []
            
            for child_id in children_ids:
                child_width = layout_tree(child_id, x + total_width, y + 180, level + 1)
                child_positions.append(total_width + child_width / 2)
                total_width += child_width
            
            # Position parent centered above children
            center_x = x + total_width / 2 - 150
            node["position"] = {"x": center_x, "y": y}
            
            return max(300, total_width)
        
        layout_tree(root_id, 100, 50)
    
    elif request.algorithm == "grid":
        # Simple grid layout
        cols = 4
        padding = 50
        node_width = 300
        node_height = 200
        
        for i, node in enumerate(nodes):
            col = i % cols
            row = i // cols
            node["position"] = {
                "x": padding + col * (node_width + padding),
                "y": padding + row * (node_height + padding)
            }
    
    # Save updated positions
    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {
            "$set": {
                "elements.nodes": nodes,
                "updated_at": datetime.utcnow()
            }
        }
    )
    
    return {"message": "Layout applied", "algorithm": request.algorithm}