# apps/api/papertree_api/papers/models.py
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

# ============ PDF Source Mapping ============

class PDFRegion(BaseModel):
    """A region in the PDF that content maps to."""
    page: int  # 0-indexed
    # Normalized coordinates (0-1)
    x0: float = 0
    y0: float = 0
    x1: float = 1
    y1: float = 1
    
    def to_dict(self) -> dict:
        return {"page": self.page, "x0": self.x0, "y0": self.y0, "x1": self.x1, "y1": self.y1}


# ============ Book Content Blocks ============

class BookSection(BaseModel):
    """A section in the LLM-generated book content."""
    id: str
    title: str
    level: int  # 1-4
    content: str  # Markdown with LaTeX and Mermaid
    pdf_regions: List[PDFRegion] = []  # Which PDF regions this explains
    figures: List[str] = []  # References to PDF figures like "Figure 1", "Table 2"


class BookContent(BaseModel):
    """LLM-generated book explanation of the paper."""
    title: str
    authors: Optional[str] = None
    tldr: str  # One paragraph summary
    sections: List[BookSection]
    key_figures: List[Dict[str, Any]] = []  # {id, caption, pdf_region}
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    model: str = ""


class SmartOutlineItem(BaseModel):
    """Smart index item with clear titles."""
    id: str
    title: str  # LLM-generated clear title
    level: int
    section_id: str
    pdf_page: int
    description: Optional[str] = None  # Brief description


# ============ Paper Models ============

class PaperResponse(BaseModel):
    id: str
    user_id: str
    title: str
    filename: str
    created_at: datetime
    page_count: Optional[int] = None
    has_book_content: bool = False


class PaperDetailResponse(PaperResponse):
    extracted_text: Optional[str] = None
    book_content: Optional[BookContent] = None
    smart_outline: List[SmartOutlineItem] = []


class GenerateBookContentRequest(BaseModel):
    """Request to generate book content for a paper."""
    force_regenerate: bool = False


class SearchResult(BaseModel):
    text: str
    section_id: str
    context: str
    pdf_region: Optional[PDFRegion] = None