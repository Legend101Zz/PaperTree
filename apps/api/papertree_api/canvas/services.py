# apps/api/papertree_api/canvas/services.py
"""
Canvas business logic: batch export, AI queries from canvas, templates.
All OpenRouter calls go through explanations/services.py.
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from papertree_api.database import get_database
from papertree_api.explanations.services import call_openrouter

from .models import (AskMode, CanvasEdge, CanvasNode, CanvasNodeData,
                     ContentType, NodeType, SourceReference)


def _gen_node_id() -> str:
    return f"node_{uuid.uuid4().hex[:12]}"


def _gen_edge_id() -> str:
    return f"edge_{uuid.uuid4().hex[:12]}"


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


# ────────────────────────────────────────────
# Batch Export: highlights → canvas nodes
# ────────────────────────────────────────────

async def batch_export_highlights(
    paper_id: str,
    user_id: str,
    highlight_ids: List[str],
    include_explanations: bool = True,
    layout: str = "tree",
) -> Tuple[List[dict], List[dict]]:
    """
    Create canvas nodes for each highlight (and optionally their explanations).
    Returns (new_nodes, new_edges) as dicts ready for Mongo.
    """
    db = get_database()

    # Fetch canvas (or create it)
    canvas = await _get_or_create_canvas(paper_id, user_id)
    existing_nodes = canvas["elements"]["nodes"]
    existing_edges = canvas["elements"]["edges"]

    # Find the paper root node to attach under
    paper_node_id = next(
        (n["id"] for n in existing_nodes if n.get("type") == "paper"),
        None,
    )

    # Fetch highlights
    from bson import ObjectId

    highlight_docs = []
    for hid in highlight_ids:
        try:
            h = await db.highlights.find_one(
                {"_id": ObjectId(hid), "user_id": user_id}
            )
            if h:
                highlight_docs.append(h)
        except Exception:
            continue

    if not highlight_docs:
        return [], []

    new_nodes: List[dict] = []
    new_edges: List[dict] = []

    # Layout positions
    start_x = 100
    start_y = 250
    x_spacing = 350
    y_spacing = 200

    for idx, h in enumerate(highlight_docs):
        hid = str(h["_id"])

        # Check if highlight is already on canvas
        already_exists = any(
            n.get("data", {}).get("highlight_id") == hid for n in existing_nodes
        )
        if already_exists:
            continue

        # Position based on layout
        if layout == "grid":
            col = idx % 3
            row = idx // 3
            pos = {"x": start_x + col * x_spacing, "y": start_y + row * y_spacing}
        else:  # tree
            pos = {"x": start_x + idx * x_spacing, "y": start_y}

        excerpt_node_id = _gen_node_id()
        now = _now_iso()

        excerpt_node = {
            "id": excerpt_node_id,
            "type": NodeType.EXCERPT.value,
            "position": pos,
            "data": {
                "label": _truncate(h["selected_text"], 50),
                "content": h["selected_text"],
                "content_type": ContentType.PLAIN.value,
                "highlight_id": hid,
                "source": {
                    "paper_id": paper_id,
                    "page_number": h.get("page_number"),
                    "section_id": h.get("section_id"),
                    "highlight_id": hid,
                },
                "is_collapsed": False,
                "tags": [h.get("category", "none")],
                "color": h.get("color"),
                "created_at": now,
                "updated_at": now,
            },
            "parent_id": paper_node_id,
            "children_ids": [],
        }
        new_nodes.append(excerpt_node)

        # Edge from paper root → excerpt
        if paper_node_id:
            new_edges.append({
                "id": _gen_edge_id(),
                "source": paper_node_id,
                "target": excerpt_node_id,
                "label": h.get("category", ""),
                "edge_type": "default",
            })

        # Optionally add explanation nodes
        if include_explanations:
            exp_cursor = db.explanations.find(
                {"highlight_id": hid, "user_id": user_id}
            ).sort("created_at", 1)

            exp_idx = 0
            async for exp in exp_cursor:
                exp_node_id = _gen_node_id()
                exp_pos = {
                    "x": pos["x"],
                    "y": pos["y"] + (exp_idx + 1) * 180,
                }

                exp_node = {
                    "id": exp_node_id,
                    "type": NodeType.ANSWER.value,
                    "position": exp_pos,
                    "data": {
                        "label": f"AI: {_truncate(exp.get('question', ''), 40)}",
                        "content": exp.get("answer_markdown", ""),
                        "content_type": ContentType.MARKDOWN.value,
                        "question": exp.get("question"),
                        "ask_mode": exp.get("ask_mode"),
                        "highlight_id": hid,
                        "explanation_id": str(exp["_id"]),
                        "source": {
                            "paper_id": paper_id,
                            "page_number": h.get("page_number"),
                            "highlight_id": hid,
                        },
                        "is_collapsed": True,
                        "tags": [],
                        "created_at": now,
                        "updated_at": now,
                    },
                    "parent_id": excerpt_node_id,
                    "children_ids": [],
                }
                new_nodes.append(exp_node)
                excerpt_node["children_ids"].append(exp_node_id)

                new_edges.append({
                    "id": _gen_edge_id(),
                    "source": excerpt_node_id,
                    "target": exp_node_id,
                    "label": exp.get("ask_mode", ""),
                    "edge_type": "followup",
                })

                # Link explanation back to its DB record
                await db.explanations.update_one(
                    {"_id": exp["_id"]},
                    {"$set": {"canvas_node_id": exp_node_id}},
                )

                exp_idx += 1

    # Persist to canvas
    if new_nodes or new_edges:
        # Update paper node's children
        all_nodes = existing_nodes + new_nodes
        if paper_node_id:
            for n in all_nodes:
                if n["id"] == paper_node_id:
                    if "children_ids" not in n:
                        n["children_ids"] = []
                    for nn in new_nodes:
                        if nn.get("parent_id") == paper_node_id:
                            n["children_ids"].append(nn["id"])
                    break

        all_edges = existing_edges + new_edges

        await db.canvases.update_one(
            {"_id": canvas["_id"]},
            {
                "$set": {
                    "elements.nodes": all_nodes,
                    "elements.edges": all_edges,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

    return new_nodes, new_edges


# ────────────────────────────────────────────
# Canvas AI Query: ask from a canvas node
# ────────────────────────────────────────────

async def canvas_ai_query(
    paper_id: str,
    user_id: str,
    parent_node_id: str,
    question: str,
    ask_mode: str = "explain_simply",
    include_paper_context: bool = True,
) -> Tuple[dict, dict]:
    """
    Run an AI query from a canvas node. Creates a new child node with the answer.
    Returns (new_node, new_edge) dicts.
    """
    db = get_database()
    canvas = await db.canvases.find_one(
        {"paper_id": paper_id, "user_id": user_id}
    )
    if not canvas:
        raise ValueError("Canvas not found")

    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]

    parent_node = next((n for n in nodes if n["id"] == parent_node_id), None)
    if not parent_node:
        raise ValueError("Parent node not found")

    # Build context from parent node
    parent_data = parent_node.get("data", {})
    parent_content = parent_data.get("content", "")
    parent_question = parent_data.get("question", "")
    selected_text = parent_content or parent_question or ""

    # Optionally get paper context
    context_before = ""
    context_after = ""
    section_title = ""

    if include_paper_context:
        source = parent_data.get("source", {})
        highlight_id = parent_data.get("highlight_id") or source.get("highlight_id")

        if highlight_id:
            from bson import ObjectId

            try:
                highlight = await db.highlights.find_one(
                    {"_id": ObjectId(highlight_id)}
                )
                if highlight:
                    selected_text = highlight.get("selected_text", selected_text)

                    # Try to get surrounding context from paper
                    paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
                    if paper and paper.get("extracted_text"):
                        full_text = paper["extracted_text"]
                        pos = full_text.find(selected_text[:100])
                        if pos >= 0:
                            context_before = full_text[max(0, pos - 500) : pos]
                            end = pos + len(selected_text)
                            context_after = full_text[end : end + 500]
            except Exception:
                pass

    # Call AI
    answer = await call_openrouter(
        selected_text=selected_text,
        question=question,
        context_before=context_before,
        context_after=context_after,
        section_title=section_title,
        ask_mode=ask_mode,
    )

    # Create answer node
    now = _now_iso()
    new_node_id = _gen_node_id()

    # Position below parent
    parent_pos = parent_node.get("position", {"x": 400, "y": 200})
    siblings = [n for n in nodes if n.get("parent_id") == parent_node_id]
    offset_x = len(siblings) * 300

    new_node = {
        "id": new_node_id,
        "type": NodeType.ANSWER.value,
        "position": {
            "x": parent_pos["x"] + offset_x,
            "y": parent_pos["y"] + 220,
        },
        "data": {
            "label": f"AI: {_truncate(question, 40)}",
            "content": answer,
            "content_type": ContentType.MARKDOWN.value,
            "question": question,
            "ask_mode": ask_mode,
            "highlight_id": parent_data.get("highlight_id"),
            "source": parent_data.get("source"),
            "is_collapsed": False,
            "tags": [],
            "created_at": now,
            "updated_at": now,
        },
        "parent_id": parent_node_id,
        "children_ids": [],
    }

    new_edge = {
        "id": _gen_edge_id(),
        "source": parent_node_id,
        "target": new_node_id,
        "label": ask_mode,
        "edge_type": "followup",
    }

    # Update parent's children_ids
    for n in nodes:
        if n["id"] == parent_node_id:
            if "children_ids" not in n:
                n["children_ids"] = []
            n["children_ids"].append(new_node_id)
            break

    nodes.append(new_node)
    edges.append(new_edge)

    await db.canvases.update_one(
        {"_id": canvas["_id"]},
        {
            "$set": {
                "elements.nodes": nodes,
                "elements.edges": edges,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    # Also store as a proper explanation in the DB
    highlight_id = parent_data.get("highlight_id")
    if highlight_id:
        from papertree_api.config import get_settings

        settings = get_settings()
        exp_doc = {
            "paper_id": paper_id,
            "highlight_id": highlight_id,
            "user_id": user_id,
            "parent_id": None,
            "question": question,
            "answer_markdown": answer,
            "model": settings.openrouter_model,
            "ask_mode": ask_mode,
            "created_at": datetime.utcnow(),
            "is_pinned": False,
            "is_resolved": False,
            "canvas_node_id": new_node_id,
        }
        await db.explanations.insert_one(exp_doc)

    return new_node, new_edge


# ────────────────────────────────────────────
# Template Starters
# ────────────────────────────────────────────

async def create_template_canvas(
    paper_id: str,
    user_id: str,
    template: str,
) -> List[dict]:
    """Create template nodes on the canvas."""
    db = get_database()
    canvas = await _get_or_create_canvas(paper_id, user_id)

    paper = await db.papers.find_one({"_id": __import__("bson").ObjectId(paper_id)})
    paper_title = paper["title"] if paper else "Paper"

    nodes = canvas["elements"]["nodes"]
    edges = canvas["elements"]["edges"]
    now = _now_iso()

    # Find paper root
    paper_node_id = next(
        (n["id"] for n in nodes if n.get("type") == "paper"), None
    )

    new_nodes = []
    new_edges = []

    if template == "summary_tree":
        branches = [
            ("Abstract & Goals", "What is this paper trying to solve?"),
            ("Methods", "What methodology does this paper use?"),
            ("Key Results", "What are the main findings?"),
            ("Limitations", "What are the limitations of this work?"),
            ("Future Work", "What directions does this paper suggest?"),
        ]
        for i, (label, question) in enumerate(branches):
            nid = _gen_node_id()
            new_nodes.append({
                "id": nid,
                "type": NodeType.QUESTION.value,
                "position": {"x": 100 + i * 280, "y": 250},
                "data": {
                    "label": label,
                    "content": question,
                    "content_type": ContentType.PLAIN.value,
                    "question": question,
                    "is_collapsed": False,
                    "tags": ["template"],
                    "created_at": now,
                    "updated_at": now,
                },
                "parent_id": paper_node_id,
                "children_ids": [],
            })
            if paper_node_id:
                new_edges.append({
                    "id": _gen_edge_id(),
                    "source": paper_node_id,
                    "target": nid,
                    "edge_type": "default",
                })

    elif template == "question_branch":
        branches = [
            "What problem does this solve?",
            "How is this different from prior work?",
            "What evidence supports the claims?",
            "What would I do differently?",
        ]
        for i, q in enumerate(branches):
            nid = _gen_node_id()
            new_nodes.append({
                "id": nid,
                "type": NodeType.QUESTION.value,
                "position": {"x": 100 + i * 300, "y": 250},
                "data": {
                    "label": _truncate(q, 35),
                    "content": q,
                    "content_type": ContentType.PLAIN.value,
                    "question": q,
                    "is_collapsed": False,
                    "tags": ["template"],
                    "created_at": now,
                    "updated_at": now,
                },
                "parent_id": paper_node_id,
                "children_ids": [],
            })
            if paper_node_id:
                new_edges.append({
                    "id": _gen_edge_id(),
                    "source": paper_node_id,
                    "target": nid,
                    "edge_type": "default",
                })

    elif template == "critique_map":
        categories = [
            ("Strengths", "#22c55e"),
            ("Weaknesses", "#ef4444"),
            ("Questions", "#a855f7"),
            ("Connections", "#3b82f6"),
        ]
        for i, (label, color) in enumerate(categories):
            nid = _gen_node_id()
            new_nodes.append({
                "id": nid,
                "type": NodeType.NOTE.value,
                "position": {"x": 100 + i * 300, "y": 250},
                "data": {
                    "label": label,
                    "content": f"Add {label.lower()} here...",
                    "content_type": ContentType.PLAIN.value,
                    "is_collapsed": False,
                    "tags": ["template", label.lower()],
                    "color": color,
                    "created_at": now,
                    "updated_at": now,
                },
                "parent_id": paper_node_id,
                "children_ids": [],
            })
            if paper_node_id:
                new_edges.append({
                    "id": _gen_edge_id(),
                    "source": paper_node_id,
                    "target": nid,
                    "edge_type": "default",
                })

    elif template == "concept_map":
        # Create a single AI-powered node that will be expanded
        nid = _gen_node_id()
        new_nodes.append({
            "id": nid,
            "type": NodeType.NOTE.value,
            "position": {"x": 400, "y": 250},
            "data": {
                "label": "Key Concepts",
                "content": "Use 'Ask AI' on this node to auto-extract concepts from the paper.",
                "content_type": ContentType.PLAIN.value,
                "is_collapsed": False,
                "tags": ["template", "concepts"],
                "source": {"paper_id": paper_id},
                "created_at": now,
                "updated_at": now,
            },
            "parent_id": paper_node_id,
            "children_ids": [],
        })
        if paper_node_id:
            new_edges.append({
                "id": _gen_edge_id(),
                "source": paper_node_id,
                "target": nid,
                "edge_type": "default",
            })

    # Persist
    if new_nodes:
        all_nodes = nodes + new_nodes
        all_edges = edges + new_edges

        # Update paper node children
        if paper_node_id:
            for n in all_nodes:
                if n["id"] == paper_node_id:
                    if "children_ids" not in n:
                        n["children_ids"] = []
                    for nn in new_nodes:
                        if nn.get("parent_id") == paper_node_id:
                            n["children_ids"].append(nn["id"])
                    break

        await db.canvases.update_one(
            {"paper_id": paper_id, "user_id": user_id},
            {
                "$set": {
                    "elements.nodes": all_nodes,
                    "elements.edges": all_edges,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

    return new_nodes


# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

def _truncate(text: str, length: int = 50) -> str:
    if not text:
        return ""
    return text[:length] + ("..." if len(text) > length else "")


async def _get_or_create_canvas(paper_id: str, user_id: str) -> dict:
    """Get or create a paper-based canvas."""
    db = get_database()
    canvas = await db.canvases.find_one({"paper_id": paper_id, "user_id": user_id})
    if not canvas:
        from bson import ObjectId
        paper = await db.papers.find_one({"_id": ObjectId(paper_id)})
        paper_title = paper["title"] if paper else "Paper"
        now = datetime.utcnow()
        canvas_doc = {
            "paper_id": paper_id,
            "user_id": user_id,
            "elements": {
                "nodes": [{
                    "id": f"paper-{paper_id}",
                    "type": "paper",
                    "position": {"x": 400, "y": 50},
                    "data": {
                        "label": paper_title,
                        "content": None,
                        "content_type": "plain",
                        "is_collapsed": False,
                        "tags": [],
                        "created_at": now.isoformat(),
                    },
                    "parent_id": None,
                    "children_ids": [],
                }],
                "edges": [],
            },
            "updated_at": now,
        }
        result = await db.canvases.insert_one(canvas_doc)
        canvas_doc["_id"] = result.inserted_id
        canvas = canvas_doc
    return canvas