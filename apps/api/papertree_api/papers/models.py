from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class OutlineItem(BaseModel):
    """Schema for paper outline/section item."""
    title: str
    level: int
    start_idx: int
    end_idx: int


class PaperCreate(BaseModel):
    """Schema for paper creation (internal use)."""
    title: str
    filename: str
    file_path: str


class PaperResponse(BaseModel):
    """Schema for paper response."""
    id: str
    user_id: str
    title: str
    filename: str
    created_at: datetime
    page_count: Optional[int] = None


class PaperDetailResponse(PaperResponse):
    """Schema for detailed paper response including text."""
    extracted_text: Optional[str] = None
    outline: List[OutlineItem] = []


class PaperInDB(BaseModel):
    """Internal paper model."""
    user_id: str
    title: str
    filename: str
    file_path: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    extracted_text: Optional[str] = None
    outline: List[OutlineItem] = []
    page_count: Optional[int] = None


class SearchResult(BaseModel):
    """Schema for search result."""
    text: str
    start_idx: int
    end_idx: int
    context_before: str
    context_after: str