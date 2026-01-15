from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ExplanationCreate(BaseModel):
    """Schema for creating an explanation."""
    highlight_id: str
    question: str
    parent_id: Optional[str] = None


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
    created_at: datetime
    is_pinned: bool = False
    is_resolved: bool = False


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
    created_at: datetime
    is_pinned: bool = False
    is_resolved: bool = False
    children: List["ExplanationThread"] = []


class SummarizeRequest(BaseModel):
    """Schema for summarize thread request."""
    explanation_id: str