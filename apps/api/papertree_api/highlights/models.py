# apps/api/papertree_api/highlights/models.py
from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class HighlightCategory(str, Enum):
    """Categories for color-coded highlights."""
    KEY_FINDING = "key_finding"
    QUESTION = "question"
    METHODOLOGY = "methodology"
    DEFINITION = "definition"
    IMPORTANT = "important"
    TODO = "todo"
    NONE = "none"


# Map categories to colors for consistent rendering
CATEGORY_COLORS = {
    HighlightCategory.KEY_FINDING: "#22c55e",    # green
    HighlightCategory.QUESTION: "#a855f7",        # purple
    HighlightCategory.METHODOLOGY: "#3b82f6",     # blue
    HighlightCategory.DEFINITION: "#f59e0b",      # amber
    HighlightCategory.IMPORTANT: "#ef4444",        # red
    HighlightCategory.TODO: "#06b6d4",             # cyan
    HighlightCategory.NONE: "#eab308",             # yellow (default)
}


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
    section_id: Optional[str] = None
    rects: Optional[List[Rect]] = None
    anchor: Optional[TextAnchor] = None
    category: HighlightCategory = HighlightCategory.NONE
    color: Optional[str] = None  # Override color; defaults to category color
    note: Optional[str] = None   # User's personal note


class HighlightUpdate(BaseModel):
    """Schema for updating a highlight."""
    category: Optional[HighlightCategory] = None
    color: Optional[str] = None
    note: Optional[str] = None


class HighlightResponse(BaseModel):
    """Schema for highlight response."""
    id: str
    paper_id: str
    user_id: str
    mode: str
    selected_text: str
    page_number: Optional[int] = None
    section_id: Optional[str] = None
    rects: Optional[List[Rect]] = None
    anchor: Optional[TextAnchor] = None
    category: str = "none"
    color: str = "#eab308"
    note: Optional[str] = None
    created_at: datetime


class HighlightInDB(BaseModel):
    """Internal highlight model."""
    paper_id: str
    user_id: str
    mode: str
    selected_text: str
    page_number: Optional[int] = None
    section_id: Optional[str] = None
    rects: Optional[List[dict]] = None
    anchor: Optional[dict] = None
    category: str = "none"
    color: str = "#eab308"
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)