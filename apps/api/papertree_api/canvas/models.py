# apps/api/papertree_api/canvas/models.py
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# ──── Enums ────

class NodeType(str, Enum):
    PAPER = "paper"
    EXCERPT = "excerpt"
    QUESTION = "question"
    ANSWER = "answer"
    FOLLOWUP = "followup"
    NOTE = "note"
    DIAGRAM = "diagram"
    HIGHLIGHT = "highlight"
    AI_RESPONSE = "ai_response"
    SUMMARY = "summary"
    BRANCH_ROOT = "branch_root"
    PDF_PAGE = "pdf_page"


NodeStatus = Literal["idle", "loading", "error", "complete"]


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


# ──── Shared sub-models ────

class NodePosition(BaseModel):
    x: float
    y: float


class NodeDimensions(BaseModel):
    width: float = 300
    height: float = 200


class SourceReference(BaseModel):
    paper_id: str
    page_number: Optional[int] = None
    section_id: Optional[str] = None
    section_path: List[str] = []
    highlight_id: Optional[str] = None
    block_id: Optional[str] = None


class ExcerptContext(BaseModel):
    selected_text: str
    expanded_text: str
    section_title: Optional[str] = None
    section_path: List[str] = []
    nearby_equations: List[str] = []
    nearby_figures: List[str] = []
    paragraph_context: Optional[str] = None


# ──── Canvas-level models ────

class CanvasCreate(BaseModel):
    book_id: str
    title: str = "Untitled Canvas"


class CanvasEdge(BaseModel):
    id: str
    source_id: str
    target_id: str
    label: Optional[str] = None
    edge_type: str = "default"  # "default", "branch", "reference", "followup"


class CanvasInDB(BaseModel):
    id: str = Field(alias="_id")
    user_id: str
    book_id: str
    title: str
    nodes: List[str] = []
    edges: List[CanvasEdge] = []
    viewport: Dict[str, float] = {"x": 0, "y": 0, "zoom": 1}
    created_at: datetime
    updated_at: datetime

    class Config:
        populate_by_name = True


# ──── Node-level models ────

class CanvasNodeData(BaseModel):
    """Rich node data for the new canvas system."""
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


class CanvasNodeCreate(BaseModel):
    canvas_id: str
    type: NodeType
    position: NodePosition
    title: Optional[str] = None
    content: Optional[str] = None
    data: Optional[CanvasNodeData] = None
    # Source references
    highlight_id: Optional[str] = None
    book_id: Optional[str] = None
    page_number: Optional[int] = None
    # AI config
    ai_mode: Optional[str] = None
    ai_model: Optional[str] = None
    # Tree structure
    parent_node_id: Optional[str] = None


class CanvasNodeUpdate(BaseModel):
    position: Optional[NodePosition] = None
    dimensions: Optional[NodeDimensions] = None
    title: Optional[str] = None
    content: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    is_pinned: Optional[bool] = None
    is_collapsed: Optional[bool] = None


class CanvasNodeInDB(BaseModel):
    id: str = Field(alias="_id")
    canvas_id: str
    user_id: str
    type: NodeType
    position: NodePosition
    dimensions: NodeDimensions = NodeDimensions()
    title: Optional[str] = None
    content: Optional[str] = None
    data: Optional[CanvasNodeData] = None
    status: NodeStatus = "idle"
    # Source references
    highlight_id: Optional[str] = None
    book_id: Optional[str] = None
    page_number: Optional[int] = None
    explanation_id: Optional[str] = None
    # AI metadata
    ai_mode: Optional[str] = None
    ai_model: Optional[str] = None
    ai_metadata: Optional[Dict[str, Any]] = None
    # Tree structure
    parent_node_id: Optional[str] = None
    child_node_ids: List[str] = []
    # UI state
    is_pinned: bool = False
    is_collapsed: bool = False
    created_at: datetime
    updated_at: datetime

    class Config:
        populate_by_name = True


# ──── Rich canvas node (for paper_id-based system) ────

class CanvasNode(BaseModel):
    """Full canvas node for the ReactFlow-based canvas."""
    id: str
    type: NodeType
    position: NodePosition
    data: CanvasNodeData
    parent_id: Optional[str] = None
    children_ids: List[str] = []


class CanvasElements(BaseModel):
    nodes: List[CanvasNode]
    edges: List[CanvasEdge]


class CanvasUpdate(BaseModel):
    elements: CanvasElements


class CanvasResponse(BaseModel):
    id: str
    paper_id: str
    user_id: str
    elements: CanvasElements
    updated_at: datetime


class AutoCreateNodeRequest(BaseModel):
    highlight_id: str
    explanation_id: str
    position: Optional[NodePosition] = None


class NodeLayoutRequest(BaseModel):
    algorithm: Literal["tree", "force", "grid"] = "tree"
    root_node_id: Optional[str] = None


# ──── AI / Query request models ────

class AIQueryRequest(BaseModel):
    """AI query request for canvas nodes."""
    node_id: str
    mode: str  # "explain", "summarize", "critique", "derive", "diagram", "related"
    context_node_ids: List[str] = []
    custom_prompt: Optional[str] = None
    model: str = "deepseek/deepseek-chat"


class BranchRequest(BaseModel):
    parent_node_id: str
    branch_type: str  # "question", "critique", "expand", "related", "custom"
    custom_prompt: Optional[str] = None
    position_offset: NodePosition = NodePosition(x=350, y=0)


# ──── Batch export / Canvas AI / Templates ────

class BatchExportRequest(BaseModel):
    highlight_ids: List[str]
    layout: Literal["tree", "grid", "radial"] = "tree"
    include_explanations: bool = True


class BatchExportResponse(BaseModel):
    nodes_created: int
    edges_created: int
    root_node_ids: List[str]


class CanvasAIQueryRequest(BaseModel):
    parent_node_id: str
    question: str
    ask_mode: AskMode = AskMode.EXPLAIN_SIMPLY
    include_paper_context: bool = True


class CanvasAIQueryResponse(BaseModel):
    node: CanvasNode
    edge: CanvasEdge


class CanvasTemplateRequest(BaseModel):
    template: Literal["summary_tree", "question_branch", "critique_map", "concept_map"]