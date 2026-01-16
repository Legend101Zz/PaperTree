from datetime import datetime
from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field


class OutlineItem(BaseModel):
    """Schema for paper outline/section item."""
    title: str
    level: int
    start_idx: int
    end_idx: int
    page: Optional[int] = None


# Structured content blocks for book mode
class TextBlock(BaseModel):
    type: Literal["text"] = "text"
    content: str


class HeadingBlock(BaseModel):
    type: Literal["heading"] = "heading"
    level: int  # 1-6
    content: str
    id: Optional[str] = None  # For anchor linking


class MathBlock(BaseModel):
    type: Literal["math_block"] = "math_block"
    latex: Optional[str] = None  # If we recovered LaTeX
    image_base64: Optional[str] = None  # Fallback: equation as image
    alt_text: Optional[str] = None  # Raw text for accessibility/search


class MathInline(BaseModel):
    type: Literal["math_inline"] = "math_inline"
    latex: Optional[str] = None
    image_base64: Optional[str] = None
    alt_text: Optional[str] = None


class CodeBlock(BaseModel):
    type: Literal["code"] = "code"
    content: str
    language: Optional[str] = None


class ListBlock(BaseModel):
    type: Literal["list"] = "list"
    ordered: bool = False
    items: List[str]


class TableBlock(BaseModel):
    type: Literal["table"] = "table"
    headers: List[str]
    rows: List[List[str]]
    caption: Optional[str] = None


class FigureBlock(BaseModel):
    type: Literal["figure"] = "figure"
    image_base64: Optional[str] = None
    caption: Optional[str] = None
    figure_number: Optional[str] = None


class BlockQuoteBlock(BaseModel):
    type: Literal["blockquote"] = "blockquote"
    content: str


class ReferenceItem(BaseModel):
    number: Optional[str] = None
    text: str


class ReferencesBlock(BaseModel):
    type: Literal["references"] = "references"
    items: List[ReferenceItem]


ContentBlock = Union[
    TextBlock,
    HeadingBlock,
    MathBlock,
    MathInline,
    CodeBlock,
    ListBlock,
    TableBlock,
    FigureBlock,
    BlockQuoteBlock,
    ReferencesBlock,
]


class StructuredContent(BaseModel):
    """Full structured content for book mode."""
    blocks: List[ContentBlock] = []
    metadata: dict = {}  # title, authors, abstract, etc.


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
    structured_content: Optional[StructuredContent] = None


class PaperInDB(BaseModel):
    """Internal paper model."""
    user_id: str
    title: str
    filename: str
    file_path: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    extracted_text: Optional[str] = None
    outline: List[OutlineItem] = []
    structured_content: Optional[dict] = None
    page_count: Optional[int] = None


class SearchResult(BaseModel):
    """Schema for search result."""
    text: str
    start_idx: int
    end_idx: int
    context_before: str
    context_after: str