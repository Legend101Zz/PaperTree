# apps/api/papertree_api/canvas/models.py
"""
Canvas models — Maxly-style exploration canvas.
Single canvas per paper, page super-nodes as backbone,
branching AI conversations, user notes.
"""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# ──── Enums ────

class NodeType(str, Enum):
    PAPER = "paper"              # Root node for the paper
    PAGE_SUPER = "page_super"    # Collapsible page node (backbone)
    EXPLORATION = "exploration"  # Highlighted text excerpt
    AI_RESPONSE = "ai_response"  # AI-generated explanation
    NOTE = "note"                # User sticky note
    DIAGRAM = "diagram"          # AI-generated diagram node


class ContentType(str, Enum):
    PLAIN = "plain"
    MARKDOWN = "markdown"
    LATEX = "latex"
    MERMAID = "mermaid"
    CODE = "code"
    MIXED = "mixed"


class AskMode(str, Enum):
    EXPLAIN_SIMPLY = "explain_simply"
    EXPLAIN_MATH = "explain_math"
    DERIVE_STEPS = "derive_steps"
    INTUITION = "intuition"
    PSEUDOCODE = "pseudocode"
    DIAGRAM = "diagram"
    CUSTOM = "custom"


NodeStatus = Literal["idle", "loading", "error", "complete"]


# ──── Sub-models ────

class NodePosition(BaseModel):
    x: float
    y: float


class CanvasEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None
    edge_type: str = "default"  # "default", "branch", "followup", "note"


# ──── Node data ────

class CanvasNodeData(BaseModel):
    label: str
    content: Optional[str] = None
    content_type: ContentType = ContentType.MARKDOWN
    # Page super node fields
    page_number: Optional[int] = None
    page_summary: Optional[str] = None
    # Exploration fields
    selected_text: Optional[str] = None
    highlight_id: Optional[str] = None
    explanation_id: Optional[str] = None
    # AI response fields
    question: Optional[str] = None
    ask_mode: Optional[AskMode] = None
    model: Optional[str] = None
    model_name: Optional[str] = None
    tokens_used: Optional[int] = None
    # Source reference
    source_page: Optional[int] = None
    source_highlight_id: Optional[str] = None
    # UI state
    is_collapsed: bool = False
    status: NodeStatus = "idle"
    tags: List[str] = []
    color: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CanvasNode(BaseModel):
    id: str
    type: NodeType
    position: NodePosition
    data: CanvasNodeData
    parent_id: Optional[str] = None
    children_ids: List[str] = []


class CanvasElements(BaseModel):
    nodes: List[CanvasNode] = []
    edges: List[CanvasEdge] = []


# ──── API Request/Response models ────

class ExploreRequest(BaseModel):
    """Highlight → Canvas exploration."""
    highlight_id: str
    question: str
    ask_mode: AskMode = AskMode.EXPLAIN_SIMPLY
    page_number: int  # 0-indexed


class AskFollowupRequest(BaseModel):
    """Ask a follow-up branching from any node."""
    parent_node_id: str
    question: str
    ask_mode: AskMode = AskMode.EXPLAIN_SIMPLY


class AddNoteRequest(BaseModel):
    """Add a user note to the canvas."""
    content: str
    parent_node_id: Optional[str] = None  # attach to a page or exploration
    position: Optional[NodePosition] = None


class ExpandPageRequest(BaseModel):
    """Expand/create a page super-node."""
    page_number: int  # 0-indexed


class ExploreResponse(BaseModel):
    exploration_node: CanvasNode
    ai_node: CanvasNode
    page_node: Optional[CanvasNode] = None  # if newly created
    edges: List[CanvasEdge]


class AskFollowupResponse(BaseModel):
    node: CanvasNode
    edge: CanvasEdge


class CanvasResponse(BaseModel):
    id: str
    paper_id: str
    user_id: str
    elements: CanvasElements
    updated_at: str


# ──── Legacy compat (keep old batch export working) ────

class BatchExportRequest(BaseModel):
    highlight_ids: List[str]
    layout: Literal["tree", "grid", "radial"] = "tree"
    include_explanations: bool = True


class BatchExportResponse(BaseModel):
    nodes_created: int
    edges_created: int
    root_node_ids: List[str]