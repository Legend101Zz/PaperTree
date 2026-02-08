# apps/api/papertree_api/highlights/models.py
from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional

from bson import ObjectId
from pydantic import BaseModel, Field


class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, schema):
        schema.update(type="string")
        return schema



HighlightCategory = Literal[
    "key_finding", 
    "question", 
    "methodology", 
    "definition", 
    "important", 
    "review_later"
]

CATEGORY_COLORS = {
    "key_finding": "#22c55e",      # green
    "question": "#f59e0b",          # amber
    "methodology": "#3b82f6",       # blue
    "definition": "#8b5cf6",        # purple
    "important": "#ef4444",         # red
    "review_later": "#6b7280",      # gray
}


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


class HighlightPosition(BaseModel):
    page_number: int
    rects: List[dict]  # [{x, y, width, height}] normalized 0-1
    text_start: int
    text_end: int

class HighlightCreate(BaseModel):
    book_id: str
    text: str
    position: HighlightPosition
    category: HighlightCategory = "important"
    note: Optional[str] = None
    tags: List[str] = []

class HighlightUpdate(BaseModel):
    category: Optional[HighlightCategory] = None
    note: Optional[str] = None
    tags: Optional[List[str]] = None

class HighlightInDB(BaseModel):
    id: str = Field(alias="_id")
    user_id: str
    book_id: str
    text: str
    position: HighlightPosition
    category: HighlightCategory
    color: str
    note: Optional[str] = None
    tags: List[str] = []
    explanation_id: Optional[str] = None  # Link to AI explanation
    canvas_node_id: Optional[str] = None  # Link to canvas node
    created_at: datetime
    updated_at: datetime

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class HighlightExplanation(BaseModel):
    id: str = Field(alias="_id")
    highlight_id: str
    user_id: str
    book_id: str
    mode: str  # "explain", "summarize", "critique", "define", "derive"
    prompt: str
    response: str
    model_name: str
    model_metadata: dict
    tokens_used: int
    created_at: datetime

    class Config:
        populate_by_name = True

class HighlightExplanationCreate(BaseModel):
    highlight_id: str
    mode: str = "explain"
    custom_prompt: Optional[str] = None

class HighlightSearchQuery(BaseModel):
    book_id: Optional[str] = None
    category: Optional[HighlightCategory] = None
    tags: Optional[List[str]] = None
    search_text: Optional[str] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
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
    
# ─── NEW: Paper-based highlight models (used by reader page) ───

class PaperHighlightCreate(BaseModel):
    """Create highlight using paper_id (from reader page)."""
    mode: str = "book"  # "book" or "pdf"
    selected_text: str
    page_number: Optional[int] = None
    section_id: Optional[str] = None
    rects: Optional[List[dict]] = None
    anchor: Optional[dict] = None
    category: HighlightCategory = "none"
    color: Optional[str] = None
    note: Optional[str] = None


class PaperHighlightResponse(BaseModel):
    """Unified highlight response for reader page."""
    id: str
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
    created_at: datetime

    class Config:
        json_encoders = {ObjectId: str}