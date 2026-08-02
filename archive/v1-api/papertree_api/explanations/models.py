# apps/api/papertree_api/explanations/models.py
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class AskMode(str, Enum):
    """Ask modes for AI explanations."""
    EXPLAIN_SIMPLY = "explain_simply"
    EXPLAIN_MATH = "explain_math"
    DERIVE_STEPS = "derive_steps"
    INTUITION = "intuition"
    PSEUDOCODE = "pseudocode"
    DIAGRAM = "diagram"
    CUSTOM = "custom"


class ExplanationCreate(BaseModel):
    """Schema for creating an explanation."""
    highlight_id: str
    question: str
    parent_id: Optional[str] = None
    ask_mode: AskMode = AskMode.EXPLAIN_SIMPLY
    auto_add_to_canvas: bool = True  # NEW: Auto-create canvas node


class ExplanationUpdate(BaseModel):
    """Schema for updating an explanation."""
    is_pinned: Optional[bool] = None
    is_resolved: Optional[bool] = None


class ExplanationResponse(BaseModel):
    """Schema for explanation response."""
    id: str
    paper_id: str
    highlight_id: str
    user_id: str
    parent_id: Optional[str] = None
    question: str
    answer_markdown: str
    model: str
    ask_mode: AskMode = AskMode.EXPLAIN_SIMPLY
    created_at: datetime
    is_pinned: bool = False
    is_resolved: bool = False
    canvas_node_id: Optional[str] = None  # NEW: Link to canvas node


class ExplanationThread(BaseModel):
    """Schema for explanation thread (with children)."""
    id: str
    paper_id: str
    highlight_id: str
    user_id: str
    parent_id: Optional[str] = None
    question: str
    answer_markdown: str
    model: str
    ask_mode: AskMode = AskMode.EXPLAIN_SIMPLY
    created_at: datetime
    is_pinned: bool = False
    is_resolved: bool = False
    children: List["ExplanationThread"] = []


class SummarizeRequest(BaseModel):
    """Schema for summarize thread request."""
    explanation_id: str