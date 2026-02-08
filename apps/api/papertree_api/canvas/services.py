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

# ────────────────────────────────────────────
# Tree Layout Algorithm
# ────────────────────────────────────────────

def _tree_layout(nodes: list):
    """
    Smart tree layout — adapts spacing based on node type and collapse state.
    Produces a clean, readable layout similar to Maxly/mindmap tools.
    """
    from collections import defaultdict

    if not nodes:
        return

    children_map = defaultdict(list)
    for n in nodes:
        pid = n.get("parent_id")
        if pid:
            children_map[pid].append(n["id"])

    roots = [n for n in nodes if not n.get("parent_id")]
    node_map = {n["id"]: n for n in nodes}

    # ── Spacing config per node type ──
    # Horizontal space reserved for a leaf node
    def h_space_for(node: dict) -> float:
        ntype = node.get("type", "")
        collapsed = node.get("data", {}).get("is_collapsed", True)
        if ntype == "paper":
            return 500
        if ntype == "page_super":
            return 420 if not collapsed else 300
        if ntype == "ai_response":
            return 480 if not collapsed else 320
        if ntype == "exploration":
            return 380 if not collapsed else 280
        if ntype == "note":
            return 300
        return 380

    # Vertical gap between parent and children
    def v_gap_for(parent_type: str) -> float:
        if parent_type == "paper":
            return 200       # paper → pages: generous
        if parent_type == "page_super":
            return 220       # page → explorations
        if parent_type == "exploration":
            return 200       # exploration → AI answers
        return 220            # AI → follow-ups

    # Horizontal gap between sibling subtrees
    def sibling_gap_for(parent_type: str) -> float:
        if parent_type == "paper":
            return 60         # pages spread out
        if parent_type == "page_super":
            return 50         # explorations under a page
        return 40

    def subtree_width(nid: str) -> float:
        """Calculate the total width a subtree needs."""
        node = node_map.get(nid)
        if not node:
            return 0
        kids = children_map.get(nid, [])
        if not kids:
            return h_space_for(node)

        ntype = node.get("type", "")
        gap = sibling_gap_for(ntype)
        total = sum(subtree_width(kid) for kid in kids) + gap * max(0, len(kids) - 1)
        return max(total, h_space_for(node))

    def layout_subtree(nid: str, x: float, y: float) -> float:
        """Layout a subtree rooted at nid, starting at (x, y). Returns total width used."""
        node = node_map.get(nid)
        if not node:
            return 0

        kids = children_map.get(nid, [])
        ntype = node.get("type", "")

        if not kids:
            # Leaf: place at x, centered in its space
            node["position"] = {"x": x, "y": y}
            return h_space_for(node)

        # Calculate child positions
        v_gap = v_gap_for(ntype)
        sib_gap = sibling_gap_for(ntype)
        child_y = y + v_gap

        # First pass: compute widths
        kid_widths = [(kid_id, subtree_width(kid_id)) for kid_id in kids]
        total_children_width = sum(w for _, w in kid_widths) + sib_gap * max(0, len(kids) - 1)

        # Second pass: place children
        child_x = x
        child_positions = []

        for kid_id, kid_w in kid_widths:
            actual_w = layout_subtree(kid_id, child_x, child_y)
            kid_node = node_map.get(kid_id)
            if kid_node:
                child_positions.append(kid_node["position"]["x"])
            child_x += max(actual_w, kid_w) + sib_gap

        # Center parent above its children
        if child_positions:
            center_x = (child_positions[0] + child_positions[-1]) / 2
        else:
            center_x = x

        node["position"] = {"x": center_x, "y": y}
        return max(total_children_width, h_space_for(node))

    # Layout each root
    x_cursor = 80.0
    for root in roots:
        w = layout_subtree(root["id"], x_cursor, 60)
        x_cursor += w + 120  # big gap between disconnected trees

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

async def populate_canvas(paper_id: str, user_id: str) -> dict:
    """
    Populate canvas with all pages (collapsed) and existing explanation branches.
    Called on first canvas load. Idempotent — skips nodes that already exist.
    Returns updated canvas doc.
    """
    db = get_database()
    canvas = await get_or_create_canvas(paper_id, user_id)
    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]

    paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
    if not paper:
        return canvas

    page_count = paper.get("page_count", 0)
    book_content = paper.get("book_content") or {}
    summaries = book_content.get("page_summaries", [])
    summary_map = {ps["page"]: ps for ps in summaries}

    paper_node_id = f"paper-{paper_id}"
    existing_node_ids = {n["id"] for n in nodes}
    now = _now()

    # ── 1. Create page nodes for all pages ──
    pages_created = 0
    for page_num in range(page_count):
        page_node_id = f"page-{paper_id}-{page_num}"
        if page_node_id in existing_node_ids:
            continue

        ps = summary_map.get(page_num, {})
        page_title = ps.get("title", f"Page {page_num + 1}")
        page_summary = ps.get("summary", "")

        page_node = {
            "id": page_node_id,
            "type": NodeType.PAGE_SUPER.value,
            "position": {"x": 0, "y": 0},  # Will be laid out after
            "data": {
                "label": page_title,
                "content": page_summary,
                "content_type": ContentType.MARKDOWN.value,
                "page_number": page_num,
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
        existing_node_ids.add(page_node_id)
        _add_child(nodes, paper_node_id, page_node_id)

        edges.append({
            "id": f"edge-{_uid()}",
            "source": paper_node_id,
            "target": page_node_id,
            "edge_type": "default",
        })
        pages_created += 1

    # ── 2. Pull in existing highlights + explanations as branches ──
    highlights_cursor = db.highlights.find({
        "user_id": user_id,
        "$or": [{"paper_id": paper_id}, {"book_id": paper_id}],
    })
    highlights = await highlights_cursor.to_list(length=500)

    explanations_cursor = db.explanations.find({
        "paper_id": paper_id,
        "user_id": user_id,
    }).sort("created_at", 1)
    explanations = await explanations_cursor.to_list(length=500)

    # Group explanations by highlight_id
    exp_by_highlight: Dict[str, list] = {}
    for exp in explanations:
        hid = exp.get("highlight_id", "")
        if hid not in exp_by_highlight:
            exp_by_highlight[hid] = []
        exp_by_highlight[hid].append(exp)

    explorations_created = 0
    for h in highlights:
        h_id = str(h["_id"])
        explore_node_id = f"explore-hl-{h_id}"

        if explore_node_id in existing_node_ids:
            continue

        # Determine page
        page_num = h.get("page_number")
        if page_num and page_num > 0:
            page_num = page_num - 1  # Convert 1-indexed to 0-indexed
        elif h.get("position", {}).get("page_number") is not None:
            page_num = h["position"]["page_number"]
        else:
            page_num = 0

        page_node_id = f"page-{paper_id}-{page_num}"
        if page_node_id not in existing_node_ids:
            continue  # Skip if page node doesn't exist

        selected_text = h.get("selected_text") or h.get("text", "")

        # Create exploration node
        explore_node = {
            "id": explore_node_id,
            "type": NodeType.EXPLORATION.value,
            "position": {"x": 0, "y": 0},
            "data": {
                "label": _truncate(selected_text, 50),
                "content": selected_text,
                "content_type": ContentType.PLAIN.value,
                "selected_text": selected_text,
                "highlight_id": h_id,
                "source_page": page_num,
                "source_highlight_id": h_id,
                "is_collapsed": True,
                "status": "complete",
                "tags": [],
                "created_at": h.get("created_at", now) if isinstance(h.get("created_at"), str) else (h.get("created_at") or datetime.utcnow()).isoformat(),
            },
            "parent_id": page_node_id,
            "children_ids": [],
        }

        nodes.append(explore_node)
        existing_node_ids.add(explore_node_id)
        _add_child(nodes, page_node_id, explore_node_id)
        edges.append({
            "id": f"edge-{_uid()}",
            "source": page_node_id,
            "target": explore_node_id,
            "edge_type": "branch",
        })
        explorations_created += 1

        # Add explanation nodes for this highlight
        h_exps = exp_by_highlight.get(h_id, [])
        parent_id_for_chain = explore_node_id

        for exp in h_exps:
            exp_id = str(exp["_id"])
            ai_node_id = f"ai-exp-{exp_id}"

            if ai_node_id in existing_node_ids:
                continue

            ai_node = {
                "id": ai_node_id,
                "type": NodeType.AI_RESPONSE.value,
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": f"AI: {_truncate(exp.get('question', ''), 40)}",
                    "content": exp.get("answer_markdown", ""),
                    "content_type": ContentType.MARKDOWN.value,
                    "question": exp.get("question", ""),
                    "ask_mode": exp.get("ask_mode", "explain_simply"),
                    "model": exp.get("model"),
                    "source_page": page_num,
                    "source_highlight_id": h_id,
                    "explanation_id": exp_id,
                    "is_collapsed": True,
                    "status": "complete",
                    "tags": [],
                    "created_at": exp.get("created_at", now) if isinstance(exp.get("created_at"), str) else (exp.get("created_at") or datetime.utcnow()).isoformat(),
                },
                "parent_id": parent_id_for_chain,
                "children_ids": [],
            }

            nodes.append(ai_node)
            existing_node_ids.add(ai_node_id)
            _add_child(nodes, parent_id_for_chain, ai_node_id)
            edges.append({
                "id": f"edge-{_uid()}",
                "source": parent_id_for_chain,
                "target": ai_node_id,
                "edge_type": "followup",
            })

            # Chain follow-ups: next exp hangs off this one
            if exp.get("parent_id"):
                parent_id_for_chain = ai_node_id

    # ── 3. Auto-layout all nodes ──
    _tree_layout(nodes)

    # ── 4. Save ──
    await _save_canvas(canvas["_id"], nodes, edges)
    canvas["elements"]["nodes"] = nodes
    canvas["elements"]["edges"] = edges

    return {
        "canvas": canvas,
        "pages_created": pages_created,
        "explorations_created": explorations_created,
    }

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