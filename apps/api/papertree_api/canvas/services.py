# apps/api/papertree_api/canvas/services.py
"""
Canvas business logic: Maxly-style exploration canvas.
Page super-nodes, branching AI conversations, notes.
All OpenRouter calls go through explanations/services.py.
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from papertree_api.config import get_settings
from papertree_api.database import get_database
from papertree_api.explanations.services import call_openrouter

from .models import (AskMode, CanvasEdge, CanvasElements, CanvasNode,
                     CanvasNodeData, ContentType, NodePosition, NodeType)

settings = get_settings()


def _uid() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.utcnow().isoformat()


# ────────────────────────────────────────────
# Canvas CRUD helpers
# ────────────────────────────────────────────

async def get_or_create_canvas(paper_id: str, user_id: str) -> dict:
    """Get or create the single canvas for a paper.
    Tries both user_id formats to handle auth inconsistencies."""
    db = get_database()

    # Try finding canvas — user_id might be stored in different format
    canvas = await db.canvases.find_one({
        "paper_id": paper_id,
        "user_id": user_id,
    })
    if canvas:
        return canvas

    # Create new canvas
    paper = None
    try:
        paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
    except Exception:
        pass

    paper_title = paper["title"] if paper else "Paper"
    now = datetime.utcnow()

    paper_node_id = f"paper-{paper_id}"
    paper_node = {
        "id": paper_node_id,
        "type": NodeType.PAPER.value,
        "position": {"x": 400, "y": 50},
        "data": {
            "label": paper_title,
            "content": (paper.get("book_content") or {}).get("tldr") if paper else None,
            "content_type": ContentType.MARKDOWN.value,
            "is_collapsed": False,
            "status": "complete",
            "tags": [],
            "created_at": now.isoformat(),
        },
        "parent_id": None,
        "children_ids": [],
    }

    doc = {
        "paper_id": paper_id,
        "user_id": user_id,
        "elements": {
            "nodes": [paper_node],
            "edges": [],
        },
        "updated_at": now,
    }
    result = await db.canvases.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc

def _find_node(nodes: list, node_id: str) -> Optional[dict]:
    for n in nodes:
        if n["id"] == node_id:
            return n
    return None


def _add_child(nodes: list, parent_id: str, child_id: str):
    parent = _find_node(nodes, parent_id)
    if parent:
        if "children_ids" not in parent:
            parent["children_ids"] = []
        if child_id not in parent["children_ids"]:
            parent["children_ids"].append(child_id)


async def _save_canvas(canvas_id, nodes: list, edges: list):
    db = get_database()
    await db.canvases.update_one(
        {"_id": canvas_id},
        {"$set": {
            "elements.nodes": nodes,
            "elements.edges": edges,
            "updated_at": datetime.utcnow(),
        }},
    )


# ────────────────────────────────────────────
# Page Super Nodes
# ────────────────────────────────────────────

async def ensure_page_super_node(
    paper_id: str,
    user_id: str,
    page_number: int,
) -> Tuple[dict, dict, bool]:
    """
    Ensure a page super-node exists. Returns (canvas_doc, page_node, was_created).
    """
    canvas = await get_or_create_canvas(paper_id, user_id)
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]

    page_node_id = f"page-{paper_id}-{page_number}"
    existing = _find_node(nodes, page_node_id)
    if existing:
        return canvas, existing, False

    # Fetch page summary if available
    db = get_database()
    paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
    page_summary = None
    page_title = f"Page {page_number + 1}"

    if paper and paper.get("book_content"):
        summaries = paper["book_content"].get("page_summaries", [])
        for ps in summaries:
            if ps.get("page") == page_number:
                page_title = ps.get("title", page_title)
                page_summary = ps.get("summary", "")
                break

    # Position: pages laid out horizontally under paper root
    paper_node_id = f"paper-{paper_id}"
    existing_pages = [n for n in nodes if n.get("type") == NodeType.PAGE_SUPER.value]
    x_offset = len(existing_pages) * 400
    now = _now()

    page_node = {
        "id": page_node_id,
        "type": NodeType.PAGE_SUPER.value,
        "position": {"x": 100 + x_offset, "y": 250},
        "data": {
            "label": page_title,
            "content": page_summary,
            "content_type": ContentType.MARKDOWN.value,
            "page_number": page_number,
            "page_summary": page_summary,
            "is_collapsed": True,
            "status": "complete" if page_summary else "idle",
            "tags": [],
            "created_at": now,
        },
        "parent_id": paper_node_id,
        "children_ids": [],
    }

    nodes.append(page_node)
    _add_child(nodes, paper_node_id, page_node_id)

    edges.append({
        "id": f"edge-{_uid()}",
        "source": paper_node_id,
        "target": page_node_id,
        "edge_type": "default",
    })

    await _save_canvas(canvas["_id"], nodes, edges)
    canvas["elements"]["nodes"] = nodes
    canvas["elements"]["edges"] = edges
    return canvas, page_node, True


# ────────────────────────────────────────────
# Explore: Highlight → Canvas Branch
# ────────────────────────────────────────────

async def create_exploration(
    paper_id: str,
    user_id: str,
    highlight_id: str,
    question: str,
    ask_mode: str,
    page_number: int,
) -> dict:
    """
    Main entry: highlight → page super node → exploration node → AI answer node.
    Returns {exploration_node, ai_node, page_node, edges, canvas_id}.
    """
    db = get_database()

    # 1. Ensure page super-node exists
    canvas, page_node, page_created = await ensure_page_super_node(
        paper_id, user_id, page_number
    )
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]
    page_node_id = page_node["id"]

    # 2. Fetch highlight text
    highlight = await db.highlights.find_one({"_id": ObjectId(highlight_id)})
    selected_text = highlight["selected_text"] if highlight else "Unknown text"

    # 3. Create exploration (excerpt) node
    explore_id = f"explore-{_uid()}"
    siblings = [n for n in nodes if n.get("parent_id") == page_node_id
                and n.get("type") in (NodeType.EXPLORATION.value, NodeType.NOTE.value)]
    x_offset = len(siblings) * 380
    page_pos = page_node.get("position", {"x": 100, "y": 250})
    now = _now()

    explore_node = {
        "id": explore_id,
        "type": NodeType.EXPLORATION.value,
        "position": {
            "x": page_pos["x"] - 150 + x_offset,
            "y": page_pos["y"] + 220,
        },
        "data": {
            "label": _truncate(selected_text, 60),
            "content": selected_text,
            "content_type": ContentType.PLAIN.value,
            "selected_text": selected_text,
            "highlight_id": highlight_id,
            "source_page": page_number,
            "source_highlight_id": highlight_id,
            "is_collapsed": False,
            "status": "complete",
            "tags": [],
            "created_at": now,
        },
        "parent_id": page_node_id,
        "children_ids": [],
    }

    nodes.append(explore_node)
    _add_child(nodes, page_node_id, explore_id)
    edges.append({
        "id": f"edge-{_uid()}",
        "source": page_node_id,
        "target": explore_id,
        "edge_type": "branch",
    })

    # 4. Call AI
    context_before, context_after, section_title = await _get_paper_context(
        paper_id, selected_text
    )

    answer = await call_openrouter(
        selected_text=selected_text,
        question=question,
        context_before=context_before,
        context_after=context_after,
        section_title=section_title,
        ask_mode=ask_mode,
    )

    # 5. Create AI response node
    ai_id = f"ai-{_uid()}"
    ai_node = {
        "id": ai_id,
        "type": NodeType.AI_RESPONSE.value,
        "position": {
            "x": explore_node["position"]["x"],
            "y": explore_node["position"]["y"] + 250,
        },
        "data": {
            "label": f"AI: {_truncate(question, 40)}",
            "content": answer,
            "content_type": ContentType.MARKDOWN.value,
            "question": question,
            "ask_mode": ask_mode,
            "model": settings.openrouter_model,
            "source_page": page_number,
            "source_highlight_id": highlight_id,
            "is_collapsed": False,
            "status": "complete",
            "tags": [],
            "created_at": now,
        },
        "parent_id": explore_id,
        "children_ids": [],
    }

    nodes.append(ai_node)
    _add_child(nodes, explore_id, ai_id)

    new_edge = {
        "id": f"edge-{_uid()}",
        "source": explore_id,
        "target": ai_id,
        "edge_type": "followup",
    }
    edges.append(new_edge)

    # 6. Save
    await _save_canvas(canvas["_id"], nodes, edges)

    # 7. Link explanation to highlight
    if highlight:
        await db.highlights.update_one(
            {"_id": ObjectId(highlight_id)},
            {"$set": {"canvas_node_id": explore_id}},
        )

    return {
        "canvas_id": str(canvas["_id"]),
        "exploration_node": explore_node,
        "ai_node": ai_node,
        "page_node": page_node if page_created else None,
        "new_edges": [
            {"id": f"edge-{_uid()}", "source": page_node_id, "target": explore_id, "edge_type": "branch"},
            new_edge,
        ],
    }


# ────────────────────────────────────────────
# Ask Follow-up (Branch from any node)
# ────────────────────────────────────────────
async def ask_followup(
    paper_id: str,
    user_id: str,
    parent_node_id: str,
    question: str,
    ask_mode: str,
) -> dict:
    """
    Branch a follow-up question from any existing node.
    Returns {node, edge}.
    """
    canvas = await get_or_create_canvas(paper_id, user_id)
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]

    parent = _find_node(nodes, parent_node_id)
    if not parent:
        raise ValueError(f"Parent node {parent_node_id} not found in canvas")

    parent_data = parent.get("data", {})
    # FIX: Ensure content is a string before slicing. 
    # (parent_data.get("content") or "") handles both missing keys AND explicit None values.
    content_text = parent_data.get("content") or ""
    print('test',parent_data)
    # Get the best text to use as context for the AI call
    selected_text = (
        parent_data.get("selected_text")
        or parent_data.get("question")
        or content_text[:500]
        or question  # fallback: use the question itself
    )
    source_page = parent_data.get("source_page")

    # Build conversation history walking up the tree
    conversation = _build_conversation_history(nodes, parent_node_id)

    # Get paper context
    context_before = ""
    context_after = ""
    section_title = ""
    try:
        context_before, context_after, section_title = await _get_paper_context(
            paper_id, selected_text
        )
    except Exception:
        pass  # Non-fatal: we can still answer without paper context

    # Prepend conversation history to context
    if conversation:
        context_before = f"Previous conversation in this branch:\n{conversation}\n\n---\nPaper context:\n{context_before}"

    # Call AI
    try:
        answer = await call_openrouter(
            selected_text=selected_text[:2000],  # cap length
            question=question,
            context_before=context_before[:2000],
            context_after=context_after[:1000],
            section_title=section_title,
            ask_mode=ask_mode,
        )
    except Exception as e:
        # Return error node instead of crashing
        answer = f"**Error generating response:** {str(e)}\n\nPlease try again."

    # Position: below and offset from parent
    parent_pos = parent.get("position", {"x": 400, "y": 400})
    siblings = [n for n in nodes if n.get("parent_id") == parent_node_id]
    x_offset = len(siblings) * 350
    now = _now()

    new_id = f"ai-{_uid()}"
    new_node = {
        "id": new_id,
        "type": NodeType.AI_RESPONSE.value,
        "position": {
            "x": parent_pos["x"] - 100 + x_offset,
            "y": parent_pos["y"] + 250,
        },
        "data": {
            "label": f"AI: {_truncate(question, 40)}",
            "content": answer,
            "content_type": ContentType.MARKDOWN.value,
            "question": question,
            "ask_mode": ask_mode,
            "model": settings.openrouter_model,
            "source_page": source_page,
            "source_highlight_id": parent_data.get("source_highlight_id"),
            "is_collapsed": False,
            "status": "complete",
            "tags": [],
            "created_at": now,
        },
        "parent_id": parent_node_id,
        "children_ids": [],
    }

    new_edge = {
        "id": f"edge-{_uid()}",
        "source": parent_node_id,
        "target": new_id,
        "edge_type": "followup",
        "label": _truncate(question, 25),
    }

    nodes.append(new_node)
    _add_child(nodes, parent_node_id, new_id)
    edges.append(new_edge)

    await _save_canvas(canvas["_id"], nodes, edges)

    return {"node": new_node, "edge": new_edge}

# ────────────────────────────────────────────
# Notes
# ────────────────────────────────────────────

async def add_note(
    paper_id: str,
    user_id: str,
    content: str,
    parent_node_id: Optional[str] = None,
    position: Optional[dict] = None,
) -> dict:
    """Add a user note node to the canvas."""
    canvas = await get_or_create_canvas(paper_id, user_id)
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]
    now = _now()

    note_id = f"note-{_uid()}"

    if position:
        pos = position
    elif parent_node_id:
        parent = _find_node(nodes, parent_node_id)
        parent_pos = parent.get("position", {"x": 400, "y": 400}) if parent else {"x": 400, "y": 400}
        siblings = [n for n in nodes if n.get("parent_id") == parent_node_id and n.get("type") == NodeType.NOTE.value]
        pos = {
            "x": parent_pos["x"] + 350 + len(siblings) * 250,
            "y": parent_pos["y"] + 50,
        }
    else:
        pos = {"x": 800, "y": 300}

    note_node = {
        "id": note_id,
        "type": NodeType.NOTE.value,
        "position": pos,
        "data": {
            "label": _truncate(content, 40) or "Note",
            "content": content,
            "content_type": ContentType.PLAIN.value,
            "is_collapsed": False,
            "status": "complete",
            "tags": ["note"],
            "color": "#fbbf24",
            "created_at": now,
            "updated_at": now,
        },
        "parent_id": parent_node_id,
        "children_ids": [],
    }

    nodes.append(note_node)

    new_edge = None
    if parent_node_id:
        _add_child(nodes, parent_node_id, note_id)
        new_edge = {
            "id": f"edge-{_uid()}",
            "source": parent_node_id,
            "target": note_id,
            "edge_type": "note",
        }
        edges.append(new_edge)

    await _save_canvas(canvas["_id"], nodes, edges)
    return {"node": note_node, "edge": new_edge}


# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

def _truncate(text: str, length: int = 50) -> str:
    if not text:
        return ""
    text = text.replace("\n", " ").strip()
    return text[:length] + ("…" if len(text) > length else "")


def _collect_branch_context(nodes: list, node_id: str, max_depth: int = 5) -> str:
    """Walk up the parent chain to collect context."""
    parts = []
    current_id = node_id
    depth = 0
    while current_id and depth < max_depth:
        node = _find_node(nodes, current_id)
        if not node:
            break
        data = node.get("data", {})
        content = data.get("content") or ""
        if content:
            parts.append(content[:300])
        current_id = node.get("parent_id")
        depth += 1
    parts.reverse()
    return "\n---\n".join(parts)


def _build_conversation_history(nodes: list, leaf_id: str) -> str:
    """Build Q&A conversation history from root to leaf."""
    print('hereqqq')
    chain = []
    current_id = leaf_id
    while current_id:
        node = _find_node(nodes, current_id)
        if not node:
            break
        data = node.get("data", {})
        ntype = node.get("type", "")
        if ntype == NodeType.AI_RESPONSE.value:
            q = data.get("question", "")
            a = _truncate(data.get("content") or "", 300)
            chain.append(f"Q: {q}\nA: {a}")
        elif ntype == NodeType.EXPLORATION.value:
            chain.append(f"Highlighted: {_truncate(data.get('selected_text', ''), 200)}")
        current_id = node.get("parent_id")
    chain.reverse()
    return "\n\n".join(chain)


async def _get_paper_context(paper_id: str, selected_text: str):
    """Get surrounding context from paper text."""
    db = get_database()
    paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
    if not paper:
        return "", "", ""

    paper_text = paper.get("extracted_text", "")
    context_before = ""
    context_after = ""
    section_title = ""

    if paper_text and selected_text[:100] in paper_text:
        idx = paper_text.find(selected_text[:100])
        if idx >= 0:
            context_before = paper_text[max(0, idx - 500):idx]
            end = idx + len(selected_text)
            context_after = paper_text[end:end + 500]

    return context_before, context_after, section_title