"""
Intelligent excerpt extraction service.
Expands raw selections into semantically meaningful chunks.
"""

import re
from typing import Any, Dict, List, Optional


def find_section_path(text: str, book_content: Optional[Dict], section_id: Optional[str]) -> List[str]:
    """Find the section path (hierarchy) for the given text."""
    if not book_content or not section_id:
        return []
    
    sections = book_content.get("sections", [])
    
    for section in sections:
        if section.get("id") == section_id:
            return [section.get("title", "")]
    
    return []


def find_paragraph_boundaries(text: str, selection: str) -> tuple[int, int]:
    """Find paragraph boundaries around the selection."""
    selection_start = text.find(selection)
    if selection_start == -1:
        return 0, len(text)
    
    selection_end = selection_start + len(selection)
    
    # Find paragraph start (look for double newline or start)
    para_start = selection_start
    search_pos = selection_start - 1
    while search_pos >= 0:
        if text[search_pos:search_pos+2] == "\n\n":
            para_start = search_pos + 2
            break
        search_pos -= 1
    else:
        para_start = 0
    
    # Find paragraph end (look for double newline or end)
    para_end = selection_end
    search_pos = selection_end
    while search_pos < len(text) - 1:
        if text[search_pos:search_pos+2] == "\n\n":
            para_end = search_pos
            break
        search_pos += 1
    else:
        para_end = len(text)
    
    return para_start, para_end


def find_nearby_equations(text: str, selection_start: int, window: int = 500) -> List[str]:
    """Find equations near the selection."""
    equations = []
    
    # Search window around selection
    window_start = max(0, selection_start - window)
    window_end = min(len(text), selection_start + window)
    window_text = text[window_start:window_end]
    
    # Find display equations ($$...$$)
    display_eq = re.findall(r'\$\$([^$]+)\$\$', window_text)
    equations.extend([f"$${eq}$$" for eq in display_eq])
    
    # Find inline equations ($...$) that look significant
    inline_eq = re.findall(r'(?<!\$)\$([^$]+)\$(?!\$)', window_text)
    significant_inline = [eq for eq in inline_eq if len(eq) > 5]
    equations.extend([f"${eq}$" for eq in significant_inline[:3]])  # Limit to 3
    
    return equations


def find_nearby_figures(text: str, selection_start: int, window: int = 1000) -> List[str]:
    """Find figure references near the selection."""
    figures = []
    
    window_start = max(0, selection_start - window)
    window_end = min(len(text), selection_start + window)
    window_text = text[window_start:window_end]
    
    # Find figure references
    fig_refs = re.findall(r'(?:Figure|Fig\.?)\s*(\d+[a-z]?)', window_text, re.IGNORECASE)
    figures.extend([f"Figure {ref}" for ref in set(fig_refs)])
    
    # Find table references
    table_refs = re.findall(r'Table\s*(\d+[a-z]?)', window_text, re.IGNORECASE)
    figures.extend([f"Table {ref}" for ref in set(table_refs)])
    
    return figures


def expand_selection_to_sentence(text: str, selection: str) -> str:
    """Expand selection to complete sentence(s)."""
    selection_start = text.find(selection)
    if selection_start == -1:
        return selection
    
    selection_end = selection_start + len(selection)
    
    # Sentence ending patterns
    sentence_end_pattern = r'[.!?](?:\s|$)'
    
    # Find sentence start
    sent_start = selection_start
    search_pos = selection_start - 1
    while search_pos >= 0:
        if re.match(sentence_end_pattern, text[search_pos:search_pos+2]):
            sent_start = search_pos + 2
            break
        search_pos -= 1
    else:
        # Check for paragraph start
        if selection_start > 0 and text[selection_start-1] == '\n':
            sent_start = selection_start
        else:
            sent_start = 0
    
    # Find sentence end
    sent_end = selection_end
    match = re.search(sentence_end_pattern, text[selection_end:])
    if match:
        sent_end = selection_end + match.end()
    else:
        sent_end = len(text)
    
    return text[sent_start:sent_end].strip()


def get_section_title(book_content: Optional[Dict], section_id: Optional[str]) -> Optional[str]:
    """Get section title from book content."""
    if not book_content or not section_id:
        return None
    
    sections = book_content.get("sections", [])
    for section in sections:
        if section.get("id") == section_id:
            return section.get("title")
    
    return None


async def extract_intelligent_excerpt(
    full_text: str,
    selected_text: str,
    book_content: Optional[Dict] = None,
    section_id: Optional[str] = None,
    max_expanded_length: int = 1500
) -> Dict[str, Any]:
    """
    Extract an intelligent excerpt from selected text.
    
    This expands the raw selection to include:
    - Complete sentences
    - Surrounding paragraph context
    - Section hierarchy
    - Nearby equations and figures
    
    Returns a structured excerpt context.
    """
    if not full_text or not selected_text:
        return {
            "selected_text": selected_text or "",
            "expanded_text": selected_text or "",
            "section_title": None,
            "section_path": [],
            "nearby_equations": [],
            "nearby_figures": [],
            "paragraph_context": None,
        }
    
    # Find selection position
    selection_start = full_text.find(selected_text)
    if selection_start == -1:
        # Try case-insensitive search
        lower_text = full_text.lower()
        lower_selection = selected_text.lower()
        selection_start = lower_text.find(lower_selection)
    
    if selection_start == -1:
        # Selection not found, return as-is
        return {
            "selected_text": selected_text,
            "expanded_text": selected_text,
            "section_title": get_section_title(book_content, section_id),
            "section_path": find_section_path(full_text, book_content, section_id),
            "nearby_equations": [],
            "nearby_figures": [],
            "paragraph_context": None,
        }
    
    # Expand to complete sentences
    expanded_text = expand_selection_to_sentence(full_text, selected_text)
    
    # If still short, expand to paragraph
    if len(expanded_text) < 100:
        para_start, para_end = find_paragraph_boundaries(full_text, selected_text)
        paragraph_text = full_text[para_start:para_end].strip()
        
        if len(paragraph_text) <= max_expanded_length:
            expanded_text = paragraph_text
    
    # Truncate if too long
    if len(expanded_text) > max_expanded_length:
        # Try to cut at sentence boundary
        truncated = expanded_text[:max_expanded_length]
        last_period = truncated.rfind('. ')
        if last_period > max_expanded_length // 2:
            expanded_text = truncated[:last_period + 1]
        else:
            expanded_text = truncated + "..."
    
    # Get paragraph context (for display purposes)
    para_start, para_end = find_paragraph_boundaries(full_text, selected_text)
    paragraph_context = full_text[para_start:para_end].strip()
    if len(paragraph_context) > 2000:
        paragraph_context = paragraph_context[:2000] + "..."
    
    # Find nearby equations and figures
    nearby_equations = find_nearby_equations(full_text, selection_start)
    nearby_figures = find_nearby_figures(full_text, selection_start)
    
    # Get section info
    section_title = get_section_title(book_content, section_id)
    section_path = find_section_path(full_text, book_content, section_id)
    
    return {
        "selected_text": selected_text,
        "expanded_text": expanded_text,
        "section_title": section_title,
        "section_path": section_path,
        "nearby_equations": nearby_equations,
        "nearby_figures": nearby_figures,
        "paragraph_context": paragraph_context if paragraph_context != expanded_text else None,
    }