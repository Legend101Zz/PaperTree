import base64
import io
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF

# Math font detection patterns
MATH_FONTS = {
    'cmmi', 'cmsy', 'cmex', 'msam', 'msbm',  # Computer Modern
    'symbol', 'mt extra',  # Symbol fonts
    'stix', 'cambria math', 'asana',  # Modern math fonts
    'latinmodern', 'euler',
}

MATH_CHAR_RANGES = [
    (0x0370, 0x03FF),  # Greek
    (0x2200, 0x22FF),  # Mathematical Operators
    (0x2100, 0x214F),  # Letterlike Symbols
    (0x2190, 0x21FF),  # Arrows
    (0x27C0, 0x27EF),  # Misc Math Symbols-A
    (0x2980, 0x29FF),  # Misc Math Symbols-B
    (0x2A00, 0x2AFF),  # Supplemental Math Operators
    (0x1D400, 0x1D7FF),  # Math Alphanumeric Symbols
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


def extract_pdf_content(file_path: str) -> Tuple[str, List[dict], int, dict]:
    """
    Extract text content, outline, page count, and structured content from PDF.
    
    Returns:
        Tuple of (extracted_text, outline, page_count, structured_content)
    """
    try:
        doc = fitz.open(file_path)
        page_count = len(doc)
        
        # Extract plain text for backward compatibility
        full_text = ""
        for page_num in range(page_count):
            page = doc[page_num]
            text = page.get_text("text", sort=True)
            if text:
                full_text += text + "\n\n"
        
        full_text = clean_extracted_text(full_text)
        
        # Extract outline
        outline = extract_outline_from_pdf(doc)
        if not outline:
            outline = extract_sections_from_text(full_text)
        
        # Extract structured content for book mode
        structured = extract_structured_content(doc)
        
        doc.close()
        
        return full_text.strip(), outline, page_count, structured
    
    except Exception as e:
        print(f"Error extracting PDF content: {e}")
        import traceback
        traceback.print_exc()
        return "", [], 0, {"blocks": [], "metadata": {}}


def extract_structured_content(doc: fitz.Document) -> dict:
    """
    Extract structured content blocks from PDF for rich book mode rendering.
    """
    blocks: List[dict] = []
    metadata: Dict[str, Any] = {}
    
    # Try to extract metadata
    pdf_metadata = doc.metadata
    if pdf_metadata:
        metadata["title"] = pdf_metadata.get("title", "")
        metadata["author"] = pdf_metadata.get("author", "")
        metadata["subject"] = pdf_metadata.get("subject", "")
    
    current_paragraph: List[str] = []
    in_references = False
    reference_items: List[dict] = []
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        
        # Get detailed block information
        page_dict = page.get_text("dict", sort=True)
        
        for block in page_dict.get("blocks", []):
            if block["type"] == 0:  # Text block
                block_result = process_text_block(block, page, page_num)
                
                for item in block_result:
                    # Check if we're entering references section
                    if item["type"] == "heading":
                        heading_lower = item["content"].lower()
                        if any(ref in heading_lower for ref in ["references", "bibliography", "citations"]):
                            in_references = True
                            # Flush current paragraph
                            if current_paragraph:
                                blocks.append({
                                    "type": "text",
                                    "content": " ".join(current_paragraph)
                                })
                                current_paragraph = []
                        blocks.append(item)
                    elif in_references and item["type"] == "text":
                        # Parse as reference item
                        ref_match = re.match(r'^\[?(\d+)\]?\s*(.+)$', item["content"])
                        if ref_match:
                            reference_items.append({
                                "number": ref_match.group(1),
                                "text": ref_match.group(2)
                            })
                        else:
                            reference_items.append({
                                "number": None,
                                "text": item["content"]
                            })
                    elif item["type"] in ["math_block", "math_inline"]:
                        # Flush paragraph before math
                        if current_paragraph:
                            blocks.append({
                                "type": "text",
                                "content": " ".join(current_paragraph)
                            })
                            current_paragraph = []
                        blocks.append(item)
                    elif item["type"] == "text":
                        # Accumulate paragraphs
                        content = item["content"].strip()
                        if content:
                            # Check if this starts a new paragraph
                            if is_new_paragraph(content, current_paragraph):
                                if current_paragraph:
                                    blocks.append({
                                        "type": "text",
                                        "content": " ".join(current_paragraph)
                                    })
                                current_paragraph = [content]
                            else:
                                current_paragraph.append(content)
                    else:
                        # Flush paragraph before other block types
                        if current_paragraph:
                            blocks.append({
                                "type": "text",
                                "content": " ".join(current_paragraph)
                            })
                            current_paragraph = []
                        blocks.append(item)
            
            elif block["type"] == 1:  # Image block
                # Extract image
                try:
                    img_result = extract_image_block(block, page, page_num)
                    if img_result:
                        if current_paragraph:
                            blocks.append({
                                "type": "text",
                                "content": " ".join(current_paragraph)
                            })
                            current_paragraph = []
                        blocks.append(img_result)
                except Exception:
                    pass
    
    # Flush remaining paragraph
    if current_paragraph:
        blocks.append({
            "type": "text",
            "content": " ".join(current_paragraph)
        })
    
    # Add references block if we collected any
    if reference_items:
        blocks.append({
            "type": "references",
            "items": reference_items
        })
    
    # Post-process: merge adjacent text blocks, clean up
    blocks = post_process_blocks(blocks)
    
    return {"blocks": blocks, "metadata": metadata}


def process_text_block(block: dict, page: fitz.Page, page_num: int) -> List[dict]:
    """Process a text block and return structured content items."""
    results = []
    
    for line in block.get("lines", []):
        line_text = ""
        is_math_line = False
        math_chars = 0
        total_chars = 0
        max_font_size = 0
        font_flags = 0
        
        for span in line.get("spans", []):
            text = span.get("text", "")
            font = span.get("font", "")
            size = span.get("size", 12)
            flags = span.get("flags", 0)
            
            max_font_size = max(max_font_size, size)
            font_flags |= flags
            
            # Check for math content
            if is_math_font(font):
                math_chars += len(text)
                is_math_line = True
            else:
                for char in text:
                    if is_math_char(char):
                        math_chars += 1
            
            total_chars += len(text)
            line_text += text
        
        line_text = line_text.strip()
        if not line_text:
            continue
        
        # Determine if this is a heading
        is_heading, heading_level = detect_heading(
            line_text, max_font_size, font_flags, page_num
        )
        
        if is_heading:
            results.append({
                "type": "heading",
                "level": heading_level,
                "content": line_text,
                "id": f"heading-{page_num}-{len(results)}"
            })
        elif total_chars > 0 and math_chars / total_chars > 0.3:
            # High math content - treat as math block
            latex = try_convert_to_latex(line_text)
            if is_display_math(line_text):
                results.append({
                    "type": "math_block",
                    "latex": latex,
                    "alt_text": line_text,
                    "image_base64": None  # Could extract region as image
                })
            else:
                results.append({
                    "type": "math_inline",
                    "latex": latex,
                    "alt_text": line_text
                })
        elif is_list_item(line_text):
            results.append({
                "type": "list",
                "ordered": bool(re.match(r'^\d+\.', line_text)),
                "items": [clean_list_item(line_text)]
            })
        else:
            results.append({
                "type": "text",
                "content": line_text
            })
    
    return results


def detect_heading(text: str, font_size: float, flags: int, page_num: int) -> Tuple[bool, int]:
    """
    Detect if text is a heading and determine its level.
    flags: 1=superscript, 2=italic, 4=serifed, 8=monospaced, 16=bold
    """
    text_stripped = text.strip()
    
    # Too long for a heading
    if len(text_stripped) > 100:
        return False, 0
    
    # Check for numbered section pattern
    numbered_match = re.match(r'^(\d+\.(?:\d+\.)*)\s*(.+)$', text_stripped)
    if numbered_match:
        num_part = numbered_match.group(1)
        level = num_part.count('.')
        return True, min(level, 4)
    
    # Check for common section names
    common_sections = [
        "abstract", "introduction", "background", "related work",
        "methods", "methodology", "materials and methods",
        "results", "discussion", "conclusion", "conclusions",
        "acknowledgments", "acknowledgements", "references",
        "bibliography", "appendix", "supplementary"
    ]
    
    text_lower = text_stripped.lower()
    if text_lower in common_sections or any(text_lower.startswith(s) for s in common_sections):
        return True, 1
    
    # Check for bold + larger font (typical heading)
    is_bold = bool(flags & 16)
    if is_bold and font_size >= 11 and len(text_stripped) < 60:
        if font_size >= 14:
            return True, 1
        elif font_size >= 12:
            return True, 2
        else:
            return True, 3
    
    # All caps short text
    if text_stripped.isupper() and 3 < len(text_stripped) < 50:
        return True, 1
    
    return False, 0


def try_convert_to_latex(text: str) -> Optional[str]:
    """
    Attempt to convert mathematical text to LaTeX.
    This is a best-effort heuristic conversion.
    """
    if not text:
        return None
    
    latex = text
    
    # Common substitutions
    substitutions = [
        # Greek letters
        ('α', r'\alpha'), ('β', r'\beta'), ('γ', r'\gamma'), ('δ', r'\delta'),
        ('ε', r'\epsilon'), ('ζ', r'\zeta'), ('η', r'\eta'), ('θ', r'\theta'),
        ('ι', r'\iota'), ('κ', r'\kappa'), ('λ', r'\lambda'), ('μ', r'\mu'),
        ('ν', r'\nu'), ('ξ', r'\xi'), ('π', r'\pi'), ('ρ', r'\rho'),
        ('σ', r'\sigma'), ('τ', r'\tau'), ('υ', r'\upsilon'), ('φ', r'\phi'),
        ('χ', r'\chi'), ('ψ', r'\psi'), ('ω', r'\omega'),
        ('Γ', r'\Gamma'), ('Δ', r'\Delta'), ('Θ', r'\Theta'), ('Λ', r'\Lambda'),
        ('Ξ', r'\Xi'), ('Π', r'\Pi'), ('Σ', r'\Sigma'), ('Φ', r'\Phi'),
        ('Ψ', r'\Psi'), ('Ω', r'\Omega'),
        
        # Operators and symbols
        ('∑', r'\sum'), ('∏', r'\prod'), ('∫', r'\int'),
        ('√', r'\sqrt'), ('∞', r'\infty'), ('∂', r'\partial'),
        ('∇', r'\nabla'), ('±', r'\pm'), ('×', r'\times'),
        ('÷', r'\div'), ('≤', r'\leq'), ('≥', r'\geq'),
        ('≠', r'\neq'), ('≈', r'\approx'), ('∈', r'\in'),
        ('∉', r'\notin'), ('⊂', r'\subset'), ('⊃', r'\supset'),
        ('∪', r'\cup'), ('∩', r'\cap'), ('∧', r'\land'),
        ('∨', r'\lor'), ('¬', r'\neg'), ('→', r'\rightarrow'),
        ('←', r'\leftarrow'), ('↔', r'\leftrightarrow'),
        ('⇒', r'\Rightarrow'), ('⇐', r'\Leftarrow'),
        ('∀', r'\forall'), ('∃', r'\exists'),
        ('ℝ', r'\mathbb{R}'), ('ℕ', r'\mathbb{N}'),
        ('ℤ', r'\mathbb{Z}'), ('ℂ', r'\mathbb{C}'),
        ('′', "'"), ('″', "''"),
    ]
    
    for old, new in substitutions:
        latex = latex.replace(old, new)
    
    # Try to detect fractions: a/b -> \frac{a}{b}
    latex = re.sub(r'(\w+)/(\w+)', r'\\frac{\1}{\2}', latex)
    
    # Superscripts: x^2, x^{10}
    latex = re.sub(r'\^(\d+)', r'^{\1}', latex)
    
    # Subscripts: x_i, x_{ij}
    latex = re.sub(r'_(\w)', r'_{\1}', latex)
    
    return latex if latex != text else None


def is_display_math(text: str) -> bool:
    """Check if math should be displayed as block (centered) equation."""
    # Heuristics for display math
    if len(text.strip()) > 50:
        return True
    if re.match(r'^\s*\(\d+\)\s*$', text):  # Equation number
        return True
    if any(sym in text for sym in ['∑', '∏', '∫', '=']):
        return True
    return False


def is_list_item(text: str) -> bool:
    """Check if text is a list item."""
    patterns = [
        r'^\s*[•·●○]\s+',  # Bullet points
        r'^\s*[-–—]\s+',  # Dashes
        r'^\s*\d+[.)]\s+',  # Numbered
        r'^\s*[a-z][.)]\s+',  # Lettered
        r'^\s*\([a-z\d]+\)\s+',  # Parenthetical
    ]
    return any(re.match(p, text) for p in patterns)


def clean_list_item(text: str) -> str:
    """Remove list marker from text."""
    return re.sub(r'^\s*([•·●○\-–—]|\d+[.)]|[a-z][.)]|\([a-z\d]+\))\s*', '', text)


def is_new_paragraph(text: str, current: List[str]) -> bool:
    """Determine if this text starts a new paragraph."""
    if not current:
        return True
    
    # Indentation suggests new paragraph (we can't easily detect this from text)
    # Instead, use heuristics:
    
    # Starts with capital after period
    if current and current[-1].rstrip().endswith(('.', '!', '?', ':')):
        if text and text[0].isupper():
            return True
    
    # Very short previous "paragraph" that looks like a label
    if len(current) == 1 and len(current[0]) < 30:
        return True
    
    return False


def extract_image_block(block: dict, page: fitz.Page, page_num: int) -> Optional[dict]:
    """Extract an image block as base64."""
    try:
        bbox = block.get("bbox")
        if not bbox:
            return None
        
        # Skip very small images (likely icons or decorations)
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        if width < 50 or height < 50:
            return None
        
        # Extract as pixmap
        clip = fitz.Rect(bbox)
        mat = fitz.Matrix(2, 2)  # 2x scale for quality
        pix = page.get_pixmap(matrix=mat, clip=clip)
        
        # Convert to base64 PNG
        img_bytes = pix.tobytes("png")
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')
        
        return {
            "type": "figure",
            "image_base64": img_base64,
            "caption": None,  # Would need more sophisticated detection
            "figure_number": None
        }
    except Exception:
        return None


def post_process_blocks(blocks: List[dict]) -> List[dict]:
    """Clean up and merge blocks."""
    if not blocks:
        return blocks
    
    result = []
    i = 0
    
    while i < len(blocks):
        block = blocks[i]
        
        # Merge consecutive list items of same type
        if block["type"] == "list":
            merged_items = list(block["items"])
            ordered = block["ordered"]
            j = i + 1
            while j < len(blocks) and blocks[j]["type"] == "list" and blocks[j]["ordered"] == ordered:
                merged_items.extend(blocks[j]["items"])
                j += 1
            result.append({
                "type": "list",
                "ordered": ordered,
                "items": merged_items
            })
            i = j
            continue
        
        # Merge short text blocks that got split
        if block["type"] == "text":
            content = block["content"]
            j = i + 1
            while j < len(blocks) and blocks[j]["type"] == "text":
                next_content = blocks[j]["content"]
                # Check if these should be merged
                if not content.endswith(('.', '!', '?', ':')):
                    content = content + " " + next_content
                    j += 1
                else:
                    break
            
            # Clean up the merged content
            content = clean_extracted_text(content)
            if content.strip():
                result.append({
                    "type": "text",
                    "content": content
                })
            i = j
            continue
        
        result.append(block)
        i += 1
    
    return result


def clean_extracted_text(text: str) -> str:
    """Clean up common PDF extraction artifacts."""
    if not text:
        return ""
    
    # Ligature fixes
    ligature_map = {
        'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
        'ﬅ': 'st', 'ﬆ': 'st',
        '−': '-', '–': '-', '—': '-',
        '"': '"', '"': '"', ''': "'", ''': "'",
        '…': '...', '\u00ad': '', '\u200b': '', '\ufeff': '',
    }
    
    for old, new in ligature_map.items():
        text = text.replace(old, new)
    
    # Fix hyphenation at line breaks
    text = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', text)
    
    # Fix missing spaces after periods
    text = re.sub(r'\.([A-Z][a-z])', r'. \1', text)
    
    # Fix multiple spaces and newlines
    text = re.sub(r' +', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'\s+([.,;:!?])', r'\1', text)
    
    return text.strip()


def extract_outline_from_pdf(doc: fitz.Document) -> List[dict]:
    """Extract table of contents from PDF metadata."""
    try:
        toc = doc.get_toc()
        if not toc:
            return []
        
        outline = []
        for item in toc:
            level, title, page = item[:3]
            outline.append({
                "title": title.strip(),
                "level": level,
                "start_idx": 0,
                "end_idx": 0,
                "page": page
            })
        
        return outline
    except Exception:
        return []


def extract_sections_from_text(text: str) -> List[dict]:
    """Extract section headings from text."""
    sections = []
    lines = text.split('\n')
    current_idx = 0
    
    patterns = [
        (r'^(\d+\.(?:\d+\.)*)\s*([A-Z][^\n]{2,60})$', 1),
        (r'^(I{1,3}|IV|V|VI{1,3}|IX|X)\.?\s+([A-Z][^\n]{2,60})$', 1),
        (r'^([A-Z][A-Z\s]{2,40})$', 1),
        (r'^(Abstract|Introduction|Background|Related Work|Methods?|Methodology|'
         r'Materials and Methods|Results?|Discussion|Conclusions?|'
         r'Acknowledgm?ents?|References|Bibliography|Appendix|'
         r'Supplementary|Future Work|Limitations)s?\.?\s*$', 1),
    ]
    
    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            current_idx += len(line) + 1
            continue
        
        for pattern, level in patterns:
            match = re.match(pattern, line_stripped, re.IGNORECASE)
            if match:
                title = match.group(2) if match.lastindex >= 2 else match.group(1)
                
                if match.lastindex >= 1 and re.match(r'^\d+\.', match.group(1)):
                    level = match.group(1).count('.') + 1
                
                sections.append({
                    "title": title.strip(),
                    "level": min(level, 3),
                    "start_idx": current_idx,
                    "end_idx": current_idx + len(line_stripped)
                })
                break
        
        current_idx += len(line) + 1
    
    return sections


def search_in_text(text: str, query: str, context_chars: int = 100) -> List[dict]:
    """Search for query in text and return matches with context."""
    results = []
    query_lower = query.lower()
    text_lower = text.lower()
    
    start = 0
    while True:
        idx = text_lower.find(query_lower, start)
        if idx == -1:
            break
        
        context_start = max(0, idx - context_chars)
        context_end = min(len(text), idx + len(query) + context_chars)
        
        results.append({
            "text": text[idx:idx + len(query)],
            "start_idx": idx,
            "end_idx": idx + len(query),
            "context_before": text[context_start:idx],
            "context_after": text[idx + len(query):context_end]
        })
        
        start = idx + 1
        if len(results) >= 50:
            break
    
    return results


def detect_citations(text: str) -> List[dict]:
    """Detect citation patterns in text."""
    citations = []
    
    bracket_pattern = r'\[(\d+(?:[,\-–]\s*\d+)*)\]'
    author_pattern = r'\(([A-Z][a-z]+(?:\s+(?:et\s+al\.|and\s+[A-Z][a-z]+))?\.?,?\s*\d{4}[a-z]?)\)'
    
    for match in re.finditer(bracket_pattern, text):
        citations.append({
            "type": "bracket",
            "text": match.group(0),
            "value": match.group(1),
            "start_idx": match.start(),
            "end_idx": match.end()
        })
    
    for match in re.finditer(author_pattern, text):
        citations.append({
            "type": "author",
            "text": match.group(0),
            "value": match.group(1),
            "start_idx": match.start(),
            "end_idx": match.end()
        })
    
    return citations