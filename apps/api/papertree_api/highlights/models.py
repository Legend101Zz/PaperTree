from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class Rect(BaseModel):
    """Schema for PDF highlight rectangle."""
    x: float
    y: float
    w: float
    h: float


class TextAnchor(BaseModel):
    """Schema for book mode text anchor."""
    exact: str
    prefix: str = ""
    suffix: str = ""
    section_path: List[str] = []


class HighlightCreate(BaseModel):
    """Schema for creating a highlight."""
    mode: Literal["pdf", "book"]
    selected_text: str
    page_number: Optional[int] = None
    rects: Optional[List[Rect]] = None
    anchor: Optional[TextAnchor] = None


class HighlightResponse(BaseModel):
    """Schema for highlight response."""
    id: str
    paper_id: str
    user_id: str
    mode: str
    selected_text: str
    page_number: Optional[int] = None
    rects: Optional[List[Rect]] = None
    anchor: Optional[TextAnchor] = None
    created_at: datetime


class HighlightInDB(BaseModel):
    """Internal highlight model."""
    paper_id: str
    user_id: str
    mode: str
    selected_text: str
    page_number: Optional[int] = None
    rects: Optional[List[dict]] = None
    anchor: Optional[dict] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)