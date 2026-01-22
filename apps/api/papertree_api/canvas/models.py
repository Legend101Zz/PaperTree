# apps/api/papertree_api/canvas/models.py
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


class NodeType(str, Enum):
    """Types of canvas nodes."""
    PAPER = "paper"
    EXCERPT = "excerpt"
    QUESTION = "question"
    ANSWER = "answer"
    FOLLOWUP = "followup"
    NOTE = "note"
    DIAGRAM = "diagram"


class ContentType(str, Enum):
    """Content rendering types."""
    PLAIN = "plain"
    MARKDOWN = "markdown"
    LATEX = "latex"
    MERMAID = "mermaid"
    CODE = "code"
    MIXED = "mixed"  # For answers with multiple content types


class AskMode(str, Enum):
    """Ask modes for AI explanations."""
    EXPLAIN_SIMPLY = "explain_simply"
    EXPLAIN_MATH = "explain_math"
    DERIVE_STEPS = "derive_steps"
    INTUITION = "intuition"
    PSEUDOCODE = "pseudocode"
    DIAGRAM = "diagram"
    CUSTOM = "custom"


class SourceReference(BaseModel):
    """Reference back to the paper source."""
    paper_id: str
    page_number: Optional[int] = None
    section_id: Optional[str] = None
    section_path: List[str] = []
    highlight_id: Optional[str] = None
    block_id: Optional[str] = None


class ExcerptContext(BaseModel):
    """Intelligent excerpt with context."""
    selected_text: str
    expanded_text: str  # Expanded to include surrounding context
    section_title: Optional[str] = None
    section_path: List[str] = []
    nearby_equations: List[str] = []
    nearby_figures: List[str] = []
    paragraph_context: Optional[str] = None


class CanvasNodeData(BaseModel):
    """Data for a canvas node."""
    label: str
    content: Optional[str] = None
    content_type: ContentType = ContentType.MARKDOWN
    excerpt: Optional[ExcerptContext] = None
    question: Optional[str] = None
    ask_mode: Optional[AskMode] = None
    source: Optional[SourceReference] = None
    highlight_id: Optional[str] = None
    explanation_id: Optional[str] = None
    is_collapsed: bool = False
    tags: List[str] = []
    color: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CanvasNodePosition(BaseModel):
    """Position of a node on canvas."""
    x: float
    y: float


class CanvasNodeCreate(BaseModel):
    """Schema for creating a canvas node."""
    type: NodeType
    position: CanvasNodePosition
    data: CanvasNodeData
    parent_id: Optional[str] = None  # For tree structure


class CanvasNodeUpdate(BaseModel):
    """Schema for updating a canvas node."""
    position: Optional[CanvasNodePosition] = None
    data: Optional[Dict[str, Any]] = None
    is_collapsed: Optional[bool] = None


class CanvasNode(BaseModel):
    """Full canvas node model."""
    id: str
    type: NodeType
    position: CanvasNodePosition
    data: CanvasNodeData
    parent_id: Optional[str] = None
    children_ids: List[str] = []


class CanvasEdge(BaseModel):
    """Edge connecting two nodes."""
    id: str
    source: str
    target: str
    label: Optional[str] = None
    edge_type: Literal["default", "followup", "reference"] = "default"


class CanvasElements(BaseModel):
    """All canvas elements."""
    nodes: List[CanvasNode]
    edges: List[CanvasEdge]


class CanvasUpdate(BaseModel):
    """Schema for canvas update."""
    elements: CanvasElements


class CanvasResponse(BaseModel):
    """Schema for canvas response."""
    id: str
    paper_id: str
    user_id: str
    elements: CanvasElements
    updated_at: datetime


class AutoCreateNodeRequest(BaseModel):
    """Request to auto-create a node from highlight/explanation."""
    highlight_id: str
    explanation_id: str
    position: Optional[CanvasNodePosition] = None  # Auto-position if not provided


class NodeLayoutRequest(BaseModel):
    """Request to auto-layout nodes."""
    algorithm: Literal["tree", "force", "grid"] = "tree"
    root_node_id: Optional[str] = None