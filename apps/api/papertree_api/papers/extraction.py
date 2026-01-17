# apps/api/papertree_api/papers/extraction.py
"""
Enhanced PDF extraction with proper math, figures, and source mapping.
Uses PyMuPDF for reliable extraction with fallbacks.
"""

import base64
import hashlib
import io
import os
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
from papertree_api.config import get_settings

settings = get_settings()


@dataclass
class BoundingBox:
    """Normalized bounding box (0-1 coordinates relative to page)."""
    x0: float
    y0: float
    x1: float
    y1: float
    
    def to_dict(self) -> dict:
        return {"x0": self.x0, "y0": self.y0, "x1": self.x1, "y1": self.y1}
    
    @classmethod
    def from_rect(cls, rect: fitz.Rect, page_rect: fitz.Rect) -> "BoundingBox":
        """Create normalized bbox from PyMuPDF rect."""
        pw, ph = page_rect.width, page_rect.height
        return cls(
            x0=rect.x0 / pw,
            y0=rect.y0 / ph,
            x1=rect.x1 / pw,
            y1=rect.y1 / ph
        )


@dataclass
class SourceLocation:
    """Tracks where content came from in the PDF."""
    page: int  # 0-indexed
    bbox: Optional[BoundingBox] = None
    char_start: Optional[int] = None  # For text search
    char_end: Optional[int] = None
    
    def to_dict(self) -> dict:
        d = {"page": self.page}
        if self.bbox:
            d["bbox"] = self.bbox.to_dict()
        if self.char_start is not None:
            d["char_start"] = self.char_start
        if self.char_end is not None:
            d["char_end"] = self.char_end
        return d


@dataclass
class ContentBlock:
    """Base content block with source tracking."""
    id: str
    type: str
    source: SourceLocation
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "source": self.source.to_dict()
        }


@dataclass
class HeadingBlock(ContentBlock):
    level: int
    content: str
    
    def __init__(self, id: str, source: SourceLocation, level: int, content: str):
        super().__init__(id, "heading", source)
        self.level = level
        self.content = content
    
    def to_dict(self) -> dict:
        d = super().to_dict()
        d["level"] = self.level
        d["content"] = self.content
        return d


@dataclass
class TextBlock(ContentBlock):
    content: str
    
    def __init__(self, id: str, source: SourceLocation, content: str):
        super().__init__(id, "text", source)
        self.content = content
    
    def to_dict(self) -> dict:
        d = super().to_dict()
        d["content"] = self.content
        return d


@dataclass
class MathBlock(ContentBlock):
    latex: Optional[str]
    image_id: Optional[str]  # Reference to stored image
    alt_text: str
    display: bool  # True for block, False for inline
    
    def __init__(self, id: str, source: SourceLocation, latex: Optional[str], 
                 image_id: Optional[str], alt_text: str, display: bool):
        super().__init__(id, "math", source)
        self.latex = latex
        self.image_id = image_id
        self.alt_text = alt_text
        self.display = display
    
    def to_dict(self) -> dict:
        d = super().to_dict()
        d["latex"] = self.latex
        d["image_id"] = self.image_id
        d["alt_text"] = self.alt_text
        d["display"] = self.display
        return d


@dataclass
class FigureBlock(ContentBlock):
    image_id: str
    caption: Optional[str]
    figure_number: Optional[str]
    
    def __init__(self, id: str, source: SourceLocation, image_id: str,
                 caption: Optional[str], figure_number: Optional[str]):
        super().__init__(id, "figure", source)
        self.image_id = image_id
        self.caption = caption
        self.figure_number = figure_number
    
    def to_dict(self) -> dict:
        d = super().to_dict()
        d["image_id"] = self.image_id
        d["caption"] = self.caption
        d["figure_number"] = self.figure_number
        return d


@dataclass  
class ListBlock(ContentBlock):
    items: List[str]
    ordered: bool
    
    def __init__(self, id: str, source: SourceLocation, items: List[str], ordered: bool):
        super().__init__(id, "list", source)
        self.items = items
        self.ordered = ordered
    
    def to_dict(self) -> dict:
        d = super().to_dict()
        d["items"] = self.items
        d["ordered"] = self.ordered
        return d


@dataclass
class CodeBlock(ContentBlock):
    content: str
    language: Optional[str]
    
    def __init__(self, id: str, source: SourceLocation, content: str, language: Optional[str]):
        super().__init__(id, "code", source)
        self.content = content
        self.language = language
    
    def to_dict(self) -> dict:
        d = super().to_dict()
        d["content"] = self.content
        d["language"] = self.language
        return d


@dataclass
class TableBlock(ContentBlock):
    headers: List[str]
    rows: List[List[str]]
    caption: Optional[str]
    
    def __init__(self, id: str, source: SourceLocation, headers: List[str],
                 rows: List[List[str]], caption: Optional[str]):
        super().__init__(id, "table", source)
        self.headers = headers
        self.rows = rows
        self.caption = caption
    
    def to_dict(self) -> dict:
        d = super().to_dict()
        d["headers"] = self.headers
        d["rows"] = self.rows
        d["caption"] = self.caption
        return d


@dataclass
class OutlineItem:
    """Table of contents item with block reference."""
    title: str
    level: int
    block_id: str
    page: int
    
    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "level": self.level,
            "block_id": self.block_id,
            "page": self.page
        }


@dataclass
class ExtractedImage:
    """Represents an extracted image from the PDF."""
    id: str
    data: bytes
    mime_type: str
    page: int
    bbox: BoundingBox
    
    def to_base64(self) -> str:
        return base64.b64encode(self.data).decode('utf-8')


@dataclass
class ExtractionResult:
    """Complete extraction result."""
    blocks: List[ContentBlock]
    outline: List[OutlineItem]
    images: Dict[str, ExtractedImage]
    metadata: Dict[str, Any]
    plain_text: str  # For backward compatibility and search
    page_count: int


# Math detection patterns
MATH_FONTS = {
    'cmmi', 'cmsy', 'cmex', 'msam', 'msbm', 'cmr',
    'symbol', 'mt extra', 'mathematica',
    'stix', 'cambria math', 'asana', 'xits',
    'latinmodern', 'euler', 'fourier',
    'newcm', 'libertinus', 'garamond-math'
}

MATH_CHAR_RANGES = [
    (0x0370, 0x03FF),   # Greek
    (0x2200, 0x22FF),   # Mathematical Operators
    (0x2100, 0x214F),   # Letterlike Symbols
    (0x2190, 0x21FF),   # Arrows
    (0x27C0, 0x27EF),   # Misc Math Symbols-A
    (0x2980, 0x29FF),   # Misc Math Symbols-B
    (0x2A00, 0x2AFF),   # Supplemental Math Operators
    (0x1D400, 0x1D7FF), # Math Alphanumeric Symbols
    (0x2070, 0x209F),   # Superscripts and Subscripts
]

# Common section heading patterns
SECTION_PATTERNS = [
    r'^(\d+\.(?:\d+\.)*)\s+(.+)$',  # 1. or 1.1. or 1.1.1.
    r'^([IVXLC]+\.?)\s+(.+)$',       # Roman numerals
    r'^([A-Z]\.)\s+(.+)$',           # A. B. C.
]

COMMON_SECTIONS = [
    "abstract", "introduction", "background", "related work",
    "methodology", "methods", "materials and methods", "approach",
    "experiments", "experimental setup", "evaluation",
    "results", "findings", "analysis",
    "discussion", "limitations", "future work",
    "conclusion", "conclusions", "summary",
    "acknowledgments", "acknowledgements",
    "references", "bibliography", "appendix", "supplementary"
]


def is_math_char(char: str) -> bool:
    """Check if character is likely mathematical."""
    if not char:
        return False
    code = ord(char)
    for start, end in MATH_CHAR_RANGES:
        if start <= code <= end:
            return True
    return False


def is_math_font(font_name: str) -> bool:
    """Check if font is typically used for mathematics."""
    if not font_name:
        return False
    font_lower = font_name.lower()
    return any(mf in font_lower for mf in MATH_FONTS)


def generate_block_id() -> str:
    """Generate unique block ID."""
    return f"blk_{uuid.uuid4().hex[:12]}"


def generate_image_id() -> str:
    """Generate unique image ID."""
    return f"img_{uuid.uuid4().hex[:12]}"


class PDFExtractor:
    """
    Enhanced PDF extractor with proper structure detection,
    math handling, and figure extraction.
    """
    
    def __init__(self, file_path: str, paper_id: str):
        self.file_path = file_path
        self.paper_id = paper_id
        self.doc: Optional[fitz.Document] = None
        self.blocks: List[ContentBlock] = []
        self.images: Dict[str, ExtractedImage] = {}
        self.outline: List[OutlineItem] = []
        self.plain_text_parts: List[str] = []
        self.char_offset = 0
        
        # Font size statistics for heading detection
        self.font_sizes: List[float] = []
        self.median_font_size = 12.0
        
    def extract(self) -> ExtractionResult:
        """Main extraction method."""
        try:
            self.doc = fitz.open(self.file_path)
            page_count = len(self.doc)
            
            # First pass: collect font statistics
            self._collect_font_stats()
            
            # Second pass: extract content
            for page_num in range(page_count):
                self._extract_page(page_num)
            
            # Build outline from headings
            self._build_outline()
            
            # Extract PDF's built-in TOC if available
            self._extract_toc()
            
            # Get metadata
            metadata = self._extract_metadata()
            
            # Compile plain text
            plain_text = "\n\n".join(self.plain_text_parts)
            
            self.doc.close()
            
            return ExtractionResult(
                blocks=[b.to_dict() for b in self.blocks],
                outline=[o.to_dict() for o in self.outline],
                images={k: {"id": v.id, "page": v.page, "mime_type": v.mime_type,
                           "bbox": v.bbox.to_dict()} for k, v in self.images.items()},
                metadata=metadata,
                plain_text=plain_text,
                page_count=page_count
            )
            
        except Exception as e:
            print(f"Extraction error: {e}")
            import traceback
            traceback.print_exc()
            if self.doc:
                self.doc.close()
            return ExtractionResult(
                blocks=[], outline=[], images={},
                metadata={}, plain_text="", page_count=0
            )
    
    def _collect_font_stats(self):
        """Collect font size statistics for heading detection."""
        sizes = []
        for page in self.doc:
            blocks = page.get_text("dict", sort=True)["blocks"]
            for block in blocks:
                if block["type"] == 0:  # Text
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            size = span.get("size", 12)
                            if size > 0:
                                sizes.append(size)
        
        if sizes:
            sizes.sort()
            self.median_font_size = sizes[len(sizes) // 2]
            self.font_sizes = sizes
    
    def _extract_page(self, page_num: int):
        """Extract content from a single page."""
        page = self.doc[page_num]
        page_rect = page.rect
        
        # Get text blocks with detailed info
        page_dict = page.get_text("dict", sort=True)
        
        # Extract images first
        self._extract_page_images(page, page_num)
        
        # Track text content for paragraph assembly
        current_paragraph: List[Tuple[str, fitz.Rect, dict]] = []
        
        for block in page_dict.get("blocks", []):
            if block["type"] == 0:  # Text block
                self._process_text_block(block, page, page_num, page_rect, current_paragraph)
            elif block["type"] == 1:  # Image block
                # Images are handled separately via page.get_images()
                pass
        
        # Flush remaining paragraph
        if current_paragraph:
            self._flush_paragraph(current_paragraph, page_num, page_rect)
    
    def _process_text_block(self, block: dict, page: fitz.Page, page_num: int,
                            page_rect: fitz.Rect, current_paragraph: List):
        """Process a text block and identify content type."""
        block_rect = fitz.Rect(block["bbox"])
        
        for line in block.get("lines", []):
            line_text = ""
            line_rect = fitz.Rect(line["bbox"])
            max_font_size = 0
            is_bold = False
            math_ratio = 0
            total_chars = 0
            math_chars = 0
            
            for span in line.get("spans", []):
                text = span.get("text", "")
                font = span.get("font", "")
                size = span.get("size", 12)
                flags = span.get("flags", 0)
                
                max_font_size = max(max_font_size, size)
                is_bold = is_bold or bool(flags & 16)
                
                # Count math characters
                for char in text:
                    total_chars += 1
                    if is_math_char(char) or is_math_font(font):
                        math_chars += 1
                
                line_text += text
            
            line_text = line_text.strip()
            if not line_text:
                continue
            
            if total_chars > 0:
                math_ratio = math_chars / total_chars
            
            # Determine content type
            content_type = self._classify_line(
                line_text, max_font_size, is_bold, math_ratio, page_num
            )
            
            if content_type == "heading":
                # Flush current paragraph
                if current_paragraph:
                    self._flush_paragraph(current_paragraph, page_num, page_rect)
                    current_paragraph.clear()
                
                # Create heading block
                level = self._determine_heading_level(max_font_size, line_text)
                source = SourceLocation(
                    page=page_num,
                    bbox=BoundingBox.from_rect(line_rect, page_rect),
                    char_start=self.char_offset,
                    char_end=self.char_offset + len(line_text)
                )
                self.blocks.append(HeadingBlock(
                    id=generate_block_id(),
                    source=source,
                    level=level,
                    content=line_text
                ))
                self.plain_text_parts.append(line_text)
                self.char_offset += len(line_text) + 2
                
            elif content_type == "math":
                # Flush current paragraph
                if current_paragraph:
                    self._flush_paragraph(current_paragraph, page_num, page_rect)
                    current_paragraph.clear()
                
                # Extract math region as image and attempt LaTeX conversion
                self._extract_math_block(line_text, line_rect, page, page_num, page_rect)
                
            elif content_type == "list":
                # Flush current paragraph  
                if current_paragraph:
                    self._flush_paragraph(current_paragraph, page_num, page_rect)
                    current_paragraph.clear()
                
                # Parse list item
                self._add_list_item(line_text, line_rect, page_num, page_rect)
                
            else:
                # Regular text - accumulate for paragraph
                current_paragraph.append((line_text, line_rect, {"page": page_num}))
    
    def _classify_line(self, text: str, font_size: float, is_bold: bool,
                       math_ratio: float, page_num: int) -> str:
        """Classify a line of text by content type."""
        text_stripped = text.strip()
        
        # Math detection (high math character ratio)
        if math_ratio > 0.4:
            return "math"
        
        # List item detection
        list_patterns = [
            r'^\s*[•·●○▪▸]\s+',
            r'^\s*[-–—]\s+',
            r'^\s*\d+[.)]\s+',
            r'^\s*[a-z][.)]\s+',
            r'^\s*\([a-z\d]+\)\s+',
        ]
        for pattern in list_patterns:
            if re.match(pattern, text_stripped):
                return "list"
        
        # Heading detection
        if len(text_stripped) > 100:
            return "text"
        
        # Check numbered section
        for pattern in SECTION_PATTERNS:
            if re.match(pattern, text_stripped, re.IGNORECASE):
                return "heading"
        
        # Check common section names
        text_lower = text_stripped.lower().rstrip('.')
        if text_lower in COMMON_SECTIONS:
            return "heading"
        
        # Size-based heading detection
        if font_size > self.median_font_size * 1.2:
            if is_bold or len(text_stripped) < 80:
                return "heading"
        
        # All caps short text
        if text_stripped.isupper() and 3 < len(text_stripped) < 60:
            return "heading"
        
        return "text"
    
    def _determine_heading_level(self, font_size: float, text: str) -> int:
        """Determine heading level from font size and text patterns."""
        # Check for numbered pattern
        match = re.match(r'^(\d+\.(?:\d+\.)*)', text)
        if match:
            dots = match.group(1).count('.')
            return min(dots + 1, 6)
        
        # Size-based level
        ratio = font_size / self.median_font_size
        if ratio > 1.6:
            return 1
        elif ratio > 1.3:
            return 2
        elif ratio > 1.1:
            return 3
        else:
            return 4
    
    def _flush_paragraph(self, lines: List[Tuple[str, fitz.Rect, dict]],
                         page_num: int, page_rect: fitz.Rect):
        """Combine accumulated lines into a paragraph block."""
        if not lines:
            return
        
        # Combine text, fixing hyphenation
        text_parts = []
        for i, (text, rect, meta) in enumerate(lines):
            if i > 0 and text_parts and text_parts[-1].endswith('-'):
                # Remove hyphen and join
                text_parts[-1] = text_parts[-1][:-1] + text
            else:
                text_parts.append(text)
        
        content = ' '.join(text_parts)
        content = self._clean_text(content)
        
        if not content.strip():
            return
        
        # Calculate bounding box for all lines
        x0 = min(r.x0 for _, r, _ in lines)
        y0 = min(r.y0 for _, r, _ in lines)
        x1 = max(r.x1 for _, r, _ in lines)
        y1 = max(r.y1 for _, r, _ in lines)
        combined_rect = fitz.Rect(x0, y0, x1, y1)
        
        source = SourceLocation(
            page=page_num,
            bbox=BoundingBox.from_rect(combined_rect, page_rect),
            char_start=self.char_offset,
            char_end=self.char_offset + len(content)
        )
        
        self.blocks.append(TextBlock(
            id=generate_block_id(),
            source=source,
            content=content
        ))
        
        self.plain_text_parts.append(content)
        self.char_offset += len(content) + 2
    
    def _clean_text(self, text: str) -> str:
        """Clean up extracted text."""
        # Ligature fixes
        replacements = {
            'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
            '−': '-', '–': '-', '—': '-',
            '"': '"', '"': '"', ''': "'", ''': "'",
            '…': '...', '\u00ad': '', '\u200b': '', '\ufeff': '',
        }
        for old, new in replacements.items():
            text = text.replace(old, new)
        
        # Fix multiple spaces
        text = re.sub(r' +', ' ', text)
        text = re.sub(r'\s+([.,;:!?])', r'\1', text)
        
        return text.strip()
    
    def _extract_math_block(self, text: str, rect: fitz.Rect, page: fitz.Page,
                            page_num: int, page_rect: fitz.Rect):
        """Extract math region, optionally converting to LaTeX."""
        # Try to convert text to LaTeX
        latex = self._text_to_latex(text)
        
        # Also extract as image for fallback
        image_id = None
        try:
            # Expand rect slightly for padding
            expanded = fitz.Rect(
                rect.x0 - 5, rect.y0 - 5,
                rect.x1 + 5, rect.y1 + 5
            )
            expanded = expanded & page.rect  # Clip to page
            
            mat = fitz.Matrix(2, 2)  # 2x scale
            pix = page.get_pixmap(matrix=mat, clip=expanded)
            
            image_id = generate_image_id()
            self.images[image_id] = ExtractedImage(
                id=image_id,
                data=pix.tobytes("png"),
                mime_type="image/png",
                page=page_num,
                bbox=BoundingBox.from_rect(rect, page_rect)
            )
        except Exception:
            pass
        
        source = SourceLocation(
            page=page_num,
            bbox=BoundingBox.from_rect(rect, page_rect),
            char_start=self.char_offset,
            char_end=self.char_offset + len(text)
        )
        
        # Determine if display math (centered, takes full line)
        is_display = len(text.strip()) > 20 or '=' in text
        
        self.blocks.append(MathBlock(
            id=generate_block_id(),
            source=source,
            latex=latex,
            image_id=image_id,
            alt_text=text,
            display=is_display
        ))
        
        self.plain_text_parts.append(text)
        self.char_offset += len(text) + 2
    
    def _text_to_latex(self, text: str) -> Optional[str]:
        """Convert math text to LaTeX notation."""
        if not text:
            return None
        
        latex = text
        
        # Greek letters
        greek = {
            'α': r'\alpha', 'β': r'\beta', 'γ': r'\gamma', 'δ': r'\delta',
            'ε': r'\epsilon', 'ζ': r'\zeta', 'η': r'\eta', 'θ': r'\theta',
            'ι': r'\iota', 'κ': r'\kappa', 'λ': r'\lambda', 'μ': r'\mu',
            'ν': r'\nu', 'ξ': r'\xi', 'π': r'\pi', 'ρ': r'\rho',
            'σ': r'\sigma', 'τ': r'\tau', 'υ': r'\upsilon', 'φ': r'\phi',
            'χ': r'\chi', 'ψ': r'\psi', 'ω': r'\omega',
            'Γ': r'\Gamma', 'Δ': r'\Delta', 'Θ': r'\Theta', 'Λ': r'\Lambda',
            'Ξ': r'\Xi', 'Π': r'\Pi', 'Σ': r'\Sigma', 'Φ': r'\Phi',
            'Ψ': r'\Psi', 'Ω': r'\Omega',
        }
        
        # Operators
        operators = {
            '∑': r'\sum', '∏': r'\prod', '∫': r'\int', '∬': r'\iint',
            '√': r'\sqrt', '∞': r'\infty', '∂': r'\partial',
            '∇': r'\nabla', '±': r'\pm', '×': r'\times', '÷': r'\div',
            '≤': r'\leq', '≥': r'\geq', '≠': r'\neq', '≈': r'\approx',
            '∈': r'\in', '∉': r'\notin', '⊂': r'\subset', '⊃': r'\supset',
            '∪': r'\cup', '∩': r'\cap', '∧': r'\land', '∨': r'\lor',
            '¬': r'\neg', '→': r'\rightarrow', '←': r'\leftarrow',
            '↔': r'\leftrightarrow', '⇒': r'\Rightarrow', '⇐': r'\Leftarrow',
            '∀': r'\forall', '∃': r'\exists', '∅': r'\emptyset',
            'ℝ': r'\mathbb{R}', 'ℕ': r'\mathbb{N}', 'ℤ': r'\mathbb{Z}',
            'ℂ': r'\mathbb{C}', 'ℚ': r'\mathbb{Q}',
        }
        
        for char, cmd in {**greek, **operators}.items():
            latex = latex.replace(char, cmd + ' ')
        
        # Simple fractions
        latex = re.sub(r'(\w+)/(\w+)', r'\\frac{\1}{\2}', latex)
        
        # Superscripts
        latex = re.sub(r'\^(\d+)', r'^{\1}', latex)
        latex = re.sub(r'\^([a-zA-Z])', r'^{\1}', latex)
        
        # Subscripts
        latex = re.sub(r'_(\d+)', r'_{\1}', latex)
        latex = re.sub(r'_([a-zA-Z])', r'_{\1}', latex)
        
        return latex.strip() if latex != text else None
    
    def _add_list_item(self, text: str, rect: fitz.Rect, page_num: int, page_rect: fitz.Rect):
        """Add a list item, merging with previous list if appropriate."""
        # Clean list marker
        cleaned = re.sub(r'^\s*([•·●○▪▸\-–—]|\d+[.)]|[a-z][.)]|\([a-z\d]+\))\s*', '', text)
        ordered = bool(re.match(r'^\s*\d+[.)]', text))
        
        source = SourceLocation(
            page=page_num,
            bbox=BoundingBox.from_rect(rect, page_rect),
            char_start=self.char_offset,
            char_end=self.char_offset + len(text)
        )
        
        # Check if we can merge with previous list
        if self.blocks and isinstance(self.blocks[-1], ListBlock):
            prev_list = self.blocks[-1]
            if prev_list.ordered == ordered:
                prev_list.items.append(cleaned)
                self.plain_text_parts.append(cleaned)
                self.char_offset += len(cleaned) + 2
                return
        
        self.blocks.append(ListBlock(
            id=generate_block_id(),
            source=source,
            items=[cleaned],
            ordered=ordered
        ))
        
        self.plain_text_parts.append(cleaned)
        self.char_offset += len(cleaned) + 2
    
    def _extract_page_images(self, page: fitz.Page, page_num: int):
        """Extract images from page."""
        page_rect = page.rect
        
        try:
            image_list = page.get_images(full=True)
        except Exception:
            return
        
        for img_index, img_info in enumerate(image_list):
            try:
                xref = img_info[0]
                
                # Get image bbox
                img_rects = page.get_image_rects(xref)
                if not img_rects:
                    continue
                
                img_rect = img_rects[0]
                
                # Skip small images (icons, bullets)
                if img_rect.width < 50 or img_rect.height < 50:
                    continue
                
                # Extract image
                base_image = self.doc.extract_image(xref)
                if not base_image:
                    continue
                
                image_data = base_image["image"]
                ext = base_image.get("ext", "png")
                mime_map = {"png": "image/png", "jpg": "image/jpeg", 
                           "jpeg": "image/jpeg", "gif": "image/gif"}
                mime_type = mime_map.get(ext, "image/png")
                
                image_id = generate_image_id()
                bbox = BoundingBox.from_rect(img_rect, page_rect)
                
                self.images[image_id] = ExtractedImage(
                    id=image_id,
                    data=image_data,
                    mime_type=mime_type,
                    page=page_num,
                    bbox=bbox
                )
                
                # Try to find caption
                caption = self._find_figure_caption(page, img_rect)
                figure_number = self._extract_figure_number(caption) if caption else None
                
                source = SourceLocation(page=page_num, bbox=bbox)
                
                self.blocks.append(FigureBlock(
                    id=generate_block_id(),
                    source=source,
                    image_id=image_id,
                    caption=caption,
                    figure_number=figure_number
                ))
                
            except Exception:
                continue
    
    def _find_figure_caption(self, page: fitz.Page, img_rect: fitz.Rect) -> Optional[str]:
        """Find caption text near an image."""
        # Look for text below the image
        search_rect = fitz.Rect(
            img_rect.x0 - 20,
            img_rect.y1,
            img_rect.x1 + 20,
            img_rect.y1 + 60
        )
        search_rect = search_rect & page.rect
        
        text = page.get_text("text", clip=search_rect).strip()
        
        # Check if it looks like a caption
        caption_pattern = r'^(Figure|Fig\.?|Table|Scheme)\s*\d'
        if re.match(caption_pattern, text, re.IGNORECASE):
            # Get first paragraph
            lines = text.split('\n')
            caption_lines = []
            for line in lines:
                line = line.strip()
                if line:
                    caption_lines.append(line)
                    if line.endswith('.'):
                        break
                elif caption_lines:
                    break
            return ' '.join(caption_lines)[:500]  # Limit length
        
        return None
    
    def _extract_figure_number(self, caption: str) -> Optional[str]:
        """Extract figure number from caption."""
        match = re.match(r'^(Figure|Fig\.?|Table|Scheme)\s*(\d+[a-z]?)', caption, re.IGNORECASE)
        if match:
            return match.group(2)
        return None
    
    def _build_outline(self):
        """Build outline from heading blocks."""
        for block in self.blocks:
            if isinstance(block, HeadingBlock):
                self.outline.append(OutlineItem(
                    title=block.content,
                    level=block.level,
                    block_id=block.id,
                    page=block.source.page
                ))
    
    def _extract_toc(self):
        """Extract PDF's built-in table of contents."""
        try:
            toc = self.doc.get_toc()
            if not toc or len(toc) <= len(self.outline):
                return  # Use detected outline instead
            
            # If PDF has better TOC, use it but map to blocks
            new_outline = []
            for level, title, page in toc:
                # Find nearest heading block on this page
                block_id = self._find_heading_block(title, page - 1)
                new_outline.append(OutlineItem(
                    title=title.strip(),
                    level=level,
                    block_id=block_id or "",
                    page=page - 1  # Convert to 0-indexed
                ))
            
            if new_outline:
                self.outline = new_outline
                
        except Exception:
            pass
    
    def _find_heading_block(self, title: str, page: int) -> Optional[str]:
        """Find heading block matching title on page."""
        title_lower = title.lower().strip()
        
        for block in self.blocks:
            if isinstance(block, HeadingBlock):
                if block.source.page == page:
                    if block.content.lower().strip() == title_lower:
                        return block.id
                    if title_lower in block.content.lower():
                        return block.id
        
        # Fallback: find any block on this page
        for block in self.blocks:
            if block.source.page == page:
                return block.id
        
        return None
    
    def _extract_metadata(self) -> Dict[str, Any]:
        """Extract document metadata."""
        metadata = {}
        
        try:
            pdf_meta = self.doc.metadata
            if pdf_meta:
                metadata["title"] = pdf_meta.get("title", "")
                metadata["author"] = pdf_meta.get("author", "")
                metadata["subject"] = pdf_meta.get("subject", "")
                metadata["keywords"] = pdf_meta.get("keywords", "")
                metadata["creator"] = pdf_meta.get("creator", "")
        except Exception:
            pass
        
        return metadata
    
    def get_image_data(self, image_id: str) -> Optional[bytes]:
        """Get image data by ID."""
        img = self.images.get(image_id)
        return img.data if img else None


def extract_pdf_content(file_path: str, paper_id: str = "") -> ExtractionResult:
    """
    Main entry point for PDF extraction.
    Returns structured content with proper source mapping.
    """
    extractor = PDFExtractor(file_path, paper_id)
    return extractor.extract()


def search_in_blocks(blocks: List[dict], query: str, limit: int = 50) -> List[dict]:
    """
    Search within extracted blocks.
    Returns matches with block references and context.
    """
    results = []
    query_lower = query.lower()
    
    for block in blocks:
        content = ""
        if block["type"] == "text":
            content = block.get("content", "")
        elif block["type"] == "heading":
            content = block.get("content", "")
        elif block["type"] == "list":
            content = " ".join(block.get("items", []))
        elif block["type"] == "math":
            content = block.get("alt_text", "")
        
        if not content:
            continue
        
        content_lower = content.lower()
        start = 0
        
        while True:
            idx = content_lower.find(query_lower, start)
            if idx == -1:
                break
            
            # Extract context
            context_start = max(0, idx - 50)
            context_end = min(len(content), idx + len(query) + 50)
            
            results.append({
                "block_id": block["id"],
                "block_type": block["type"],
                "text": content[idx:idx + len(query)],
                "context_before": content[context_start:idx],
                "context_after": content[idx + len(query):context_end],
                "source": block.get("source", {})
            })
            
            start = idx + 1
            
            if len(results) >= limit:
                return results
    
    return results