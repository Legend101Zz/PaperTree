import os
import re
from typing import List, Optional, Tuple

from papertree_api.config import get_settings
from PyPDF2 import PdfReader

settings = get_settings()


def extract_pdf_content(file_path: str) -> Tuple[str, List[dict], int]:
    """
    Extract text content, outline, and page count from a PDF file.
    
    Returns:
        Tuple of (extracted_text, outline, page_count)
    """
    try:
        reader = PdfReader(file_path)
        page_count = len(reader.pages)
        
        # Extract text from all pages
        full_text = ""
        for page in reader.pages:
            text = page.extract_text()
            if text:
                full_text += text + "\n\n"
        
        # Try to extract outline/sections (best effort)
        outline = extract_sections(full_text)
        
        return full_text.strip(), outline, page_count
    
    except Exception as e:
        print(f"Error extracting PDF content: {e}")
        return "", [], 0


def extract_sections(text: str) -> List[dict]:
    """
    Extract section headings from text (best effort).
    Looks for common patterns like numbered sections, capitalized headings, etc.
    """
    sections = []
    lines = text.split('\n')
    current_idx = 0
    
    # Patterns for section detection
    patterns = [
        # Numbered sections: "1. Introduction", "1.1 Background"
        r'^(\d+\.?\d*\.?\d*)\s+([A-Z][^.!?]*?)$',
        # All caps headings
        r'^([A-Z][A-Z\s]{3,50})$',
        # Roman numerals
        r'^(I{1,3}|IV|V|VI{1,3}|IX|X)\.\s+(.+)$',
    ]
    
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            current_idx += 1
            continue
            
        for pattern in patterns:
            match = re.match(pattern, line)
            if match:
                # Determine level based on pattern
                if '.' in match.group(1) if match.lastindex >= 1 else False:
                    level = match.group(1).count('.') + 1
                else:
                    level = 1
                
                title = match.group(2) if match.lastindex >= 2 else match.group(1)
                
                sections.append({
                    "title": title.strip(),
                    "level": min(level, 3),  # Cap at level 3
                    "start_idx": current_idx,
                    "end_idx": current_idx + len(line)
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
    
    return results


def detect_citations(text: str) -> List[dict]:
    """
    Detect citation patterns in text.
    """
    citations = []
    
    # Pattern for [1], [12], etc.
    bracket_pattern = r'\[(\d+(?:,\s*\d+)*)\]'
    
    # Pattern for (Author et al., Year)
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