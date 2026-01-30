# apps/api/papertree_api/papers/models.py
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

# ============ PDF Source Mapping ============

class PDFRegion(BaseModel):
    """A region in the PDF that content maps to."""
    page: int  # 0-indexed
    x0: float = 0
    y0: float = 0
    x1: float = 1
    y1: float = 1
    
    def to_dict(self) -> dict:
        return {"page": self.page, "x0": self.x0, "y0": self.y0, "x1": self.x1, "y1": self.y1}


# ============ Page Summary (NEW) ============

class PageSummary(BaseModel):
    """Summary for a single PDF page."""
    page: int  # 0-indexed
    title: str  # Auto-generated title for this page's content
    summary: str  # Main explanation in markdown
    key_concepts: List[str] = []  # Bullet points of key ideas
    has_math: bool = False
    has_figures: bool = False
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    model: str = ""


class PageSummaryStatus(BaseModel):
    """Status of page summaries for a paper."""
    total_pages: int
    generated_pages: List[int]  # 0-indexed pages that have summaries
    default_limit: int = 5  # How many pages we generate by default


# ============ Book Content Blocks ============

class BookSection(BaseModel):
    """A section in the LLM-generated book content."""
    id: str
    title: str
    level: int  # 1-4
    content: str  # Markdown with LaTeX and Mermaid
    pdf_pages: List[int] = []  # Which PDF pages this section covers (0-indexed)
    figures: List[str] = []  # References to PDF figures


class BookContent(BaseModel):
    """LLM-generated book explanation of the paper."""
    title: str
    authors: Optional[str] = None
    tldr: str  # One paragraph summary
    sections: List[BookSection] = []  # Legacy - kept for backwards compat
    page_summaries: List[PageSummary] = []  # NEW: page-by-page summaries
    summary_status: Optional[PageSummaryStatus] = None  # NEW
    key_figures: List[Dict[str, Any]] = []
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    model: str = ""


class SmartOutlineItem(BaseModel):
    """Smart index item with clear titles."""
    id: str
    title: str
    level: int
    section_id: str  # Can be page number like "page-0"
    pdf_page: int
    description: Optional[str] = None


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
    pages: Optional[List[int]] = None  # NEW: specific pages to generate (0-indexed)
    generate_all: bool = False  # NEW: generate all pages


class GeneratePagesRequest(BaseModel):
    """Request to generate specific page summaries."""
    pages: List[int]  # 0-indexed page numbers


class SearchResult(BaseModel):
    text: str
    section_id: str
    context: str
    pdf_region: Optional[PDFRegion] = None