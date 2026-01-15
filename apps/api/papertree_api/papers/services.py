import os
import re
from typing import List, Tuple

import fitz  # PyMuPDF


def extract_pdf_content(file_path: str) -> Tuple[str, List[dict], int]:
    """
    Extract text content, outline, and page count from a PDF file.
    Uses PyMuPDF for better text extraction quality.
    
    Returns:
        Tuple of (extracted_text, outline, page_count)
    """
    try:
        doc = fitz.open(file_path)
        page_count = len(doc)
        
        # Extract text from all pages
        full_text = ""
        for page_num in range(page_count):
            page = doc[page_num]
            # Use "text" extraction with better formatting
            text = page.get_text("text", sort=True)
            if text:
                full_text += text + "\n\n"
        
        # Clean up the extracted text
        full_text = clean_extracted_text(full_text)
        
        # Try to extract outline/TOC from PDF
        outline = extract_outline_from_pdf(doc)
        
        # If no TOC found, try to detect sections from text
        if not outline:
            outline = extract_sections_from_text(full_text)
        
        doc.close()
        
        return full_text.strip(), outline, page_count
    
    except Exception as e:
        print(f"Error extracting PDF content: {e}")
        return "", [], 0


def clean_extracted_text(text: str) -> str:
    """
    Clean up common PDF extraction artifacts.
    """
    if not text:
        return ""
    
    # Fix common ligature issues
    ligature_map = {
        'ﬁ': 'fi',
        'ﬂ': 'fl',
        'ﬀ': 'ff',
        'ﬃ': 'ffi',
        'ﬄ': 'ffl',
        'ﬅ': 'st',
        'ﬆ': 'st',
        '−': '-',
        '–': '-',
        '—': '-',
        '"': '"',
        '"': '"',
        ''': "'",
        ''': "'",
        '…': '...',
        '\u00ad': '',  # Soft hyphen
        '\u200b': '',  # Zero-width space
        '\ufeff': '',  # BOM
    }
    
    for old, new in ligature_map.items():
        text = text.replace(old, new)
    
    # Fix broken words (hyphenation at line breaks)
    # Pattern: word- \n word -> word-word (for compound words) or word (for hyphenation)
    text = re.sub(r'(\w+)-\s*\n\s*(\w+)', lambda m: m.group(1) + m.group(2), text)
    
    # Fix missing spaces after periods (but not for abbreviations like "e.g." or "i.e.")
    text = re.sub(r'\.([A-Z][a-z])', r'. \1', text)
    
    # Fix multiple spaces
    text = re.sub(r' +', ' ', text)
    
    # Fix multiple newlines (keep max 2)
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # Fix spaces before punctuation
    text = re.sub(r'\s+([.,;:!?])', r'\1', text)
    
    # Fix broken sentences (single words on lines that should be joined)
    lines = text.split('\n')
    cleaned_lines = []
    buffer = ""
    
    for line in lines:
        stripped = line.strip()
        
        # Empty line - flush buffer and add blank line
        if not stripped:
            if buffer:
                cleaned_lines.append(buffer.strip())
                buffer = ""
            cleaned_lines.append("")
            continue
        
        # Check if this looks like a continuation (doesn't start with capital, number, or bullet)
        is_continuation = (
            buffer and 
            not re.match(r'^[A-Z0-9•\-\*\d\[\(]', stripped) and
            not buffer.rstrip().endswith(('.', '!', '?', ':'))
        )
        
        # Check if line is very short (likely a header or broken line)
        is_short_line = len(stripped) < 60 and not stripped.endswith(('.', '!', '?', ':'))
        
        if is_continuation:
            # Join with previous line
            buffer = buffer.rstrip() + ' ' + stripped
        else:
            # Start new paragraph
            if buffer:
                cleaned_lines.append(buffer.strip())
            buffer = stripped
    
    # Don't forget the last buffer
    if buffer:
        cleaned_lines.append(buffer.strip())
    
    # Join back
    result = '\n'.join(cleaned_lines)
    
    # Final cleanup - fix any remaining issues
    result = re.sub(r' +', ' ', result)
    result = re.sub(r'\n +', '\n', result)
    
    return result


def extract_outline_from_pdf(doc: fitz.Document) -> List[dict]:
    """
    Extract table of contents from PDF metadata if available.
    """
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
                "start_idx": 0,  # We don't have exact text indices from TOC
                "end_idx": 0,
                "page": page
            })
        
        return outline
    except Exception:
        return []


def extract_sections_from_text(text: str) -> List[dict]:
    """
    Extract section headings from text (best effort).
    Looks for common patterns like numbered sections, capitalized headings, etc.
    """
    sections = []
    lines = text.split('\n')
    current_idx = 0
    
    # Patterns for section detection (ordered by priority)
    patterns = [
        # Numbered sections: "1. Introduction", "1.1 Background", "2.3.1 Details"
        (r'^(\d+\.(?:\d+\.)*)\s*([A-Z][^\n]{2,60})$', 1),
        # Roman numerals: "I. Introduction", "II. Methods"
        (r'^(I{1,3}|IV|V|VI{1,3}|IX|X)\.?\s+([A-Z][^\n]{2,60})$', 1),
        # All caps headings (short)
        (r'^([A-Z][A-Z\s]{2,40})$', 1),
        # Common section names
        (r'^(Abstract|Introduction|Background|Related Work|Methods?|Methodology|'
         r'Materials and Methods|Results?|Discussion|Conclusions?|'
         r'Acknowledgm?ents?|References|Bibliography|Appendix|'
         r'Supplementary|Future Work|Limitations)s?\.?\s*$', 1),
    ]
    
    for i, line in enumerate(lines):
        line_stripped = line.strip()
        if not line_stripped:
            current_idx += len(line) + 1
            continue
        
        for pattern, level in patterns:
            match = re.match(pattern, line_stripped, re.IGNORECASE)
            if match:
                title = match.group(2) if match.lastindex >= 2 else match.group(1)
                title = title.strip()
                
                # Determine level from numbering
                if match.lastindex >= 1 and re.match(r'^\d+\.', match.group(1)):
                    # Count dots in number to determine level
                    num_part = match.group(1)
                    level = num_part.count('.') + 1
                
                sections.append({
                    "title": title,
                    "level": min(level, 3),  # Cap at level 3
                    "start_idx": current_idx,
                    "end_idx": current_idx + len(line_stripped)
                })
                break
        
        current_idx += len(line) + 1
    
    return sections


def search_in_text(
    text: str, 
    query: str, 
    context_chars: int = 100
) -> List[dict]:
    """
    Search for query in text and return matches with context.
    """
    results = []
    query_lower = query.lower()
    text_lower = text.lower()
    
    start = 0
    while True:
        idx = text_lower.find(query_lower, start)
        if idx == -1:
            break
        
        # Get context
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
        
        # Limit results
        if len(results) >= 50:
            break
    
    return results


def detect_citations(text: str) -> List[dict]:
    """
    Detect citation patterns in text.
    """
    citations = []
    
    # Pattern for [1], [12], [1,2,3], [1-5], etc.
    bracket_pattern = r'\[(\d+(?:[,\-–]\s*\d+)*)\]'
    
    # Pattern for (Author et al., Year) or (Author, Year)
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