"""
LLM service for generating page-by-page explanations of papers.
Optimized for clarity, simplicity, and proper math/diagram rendering.
"""

import json
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
from papertree_api.config import get_settings

settings = get_settings()


# ============ OPTIMIZED PROMPTS ============

PAGE_SUMMARY_SYSTEM_PROMPT = """You are an expert academic tutor who explains complex research papers using the Feynman Technique. Your explanations are:

1. **Crystal clear** - A smart high schooler should understand
2. **Concept-focused** - Focus on "what" and "why", not just "what happened"  
3. **Practical** - Use real-world analogies and examples
4. **Properly formatted** - Math and diagrams render correctly

## FORMATTING RULES (CRITICAL)

### Mathematics (LaTeX)
- Inline math: `$x^2$` or `$\\alpha$`
- Display math (centered, important equations):
```
$$
E = mc^2
$$
```
- ALWAYS double-escape backslashes in JSON: `$\\\\sum_{i=1}^n$`
- Keep equations simple; explain the intuition in words
- Example: "The loss function $L = \\\\frac{1}{n}\\\\sum_i (y_i - \\\\hat{y}_i)^2$ measures how wrong our predictions are—it's just the average squared error."

### Diagrams (Mermaid)
Use Mermaid for:
- Process flows
- System architectures  
- Decision trees
- Relationships

Format:
```mermaid
graph TD
    A[Input] --> B[Process]
    B --> C[Output]
```

Keep diagrams simple (max 8-10 nodes). Label nodes clearly.

### Text Formatting
- Use **bold** for key terms (first mention only)
- Use bullet points for lists of 3+ items
- Use > blockquotes for important takeaways
- Keep paragraphs short (3-4 sentences max)

## RESPONSE FORMAT
Respond with valid JSON only. No markdown code fences around the JSON."""


PAGE_SUMMARY_USER_PROMPT = """Explain this page from a research paper in a way that builds understanding.

## Page {page_num} of {total_pages}
---
{page_text}
---

## Your Task
Create a clear, educational explanation of this page's content.

Respond with this exact JSON structure:
{{
  "title": "A clear, descriptive title for this page's content (not 'Page X')",
  "summary": "Your explanation in markdown. Include:\\n- What this page is about\\n- Key concepts explained simply\\n- Any equations with intuition\\n- Mermaid diagrams if helpful for processes/architectures\\n- Real-world analogies where applicable",
  "key_concepts": ["Concept 1", "Concept 2", "Concept 3"],
  "has_math": true/false,
  "has_figures": true/false
}}

Remember:
- Explain like teaching a curious friend
- Math should have intuition, not just symbols
- Diagrams should clarify, not complicate
- Be concise but complete"""


PAPER_TLDR_SYSTEM_PROMPT = """You summarize research papers in one compelling paragraph. Your summaries:
- Start with the problem being solved
- Explain the key innovation in plain terms
- End with why it matters

Keep it under 100 words. No jargon without explanation."""


PAPER_TLDR_USER_PROMPT = """Summarize this research paper in one paragraph:

Title: {title}

First few pages:
{text_preview}

Write a TL;DR that answers: What problem? What solution? Why care?"""


# ============ EXTRACTION HELPERS ============

def extract_page_text(full_text: str, page_num: int) -> str:
    """Extract text for a specific page from the full extracted text."""
    # Our extraction format uses [Page X] markers
    pattern = rf'\[Page {page_num + 1}\]\n(.*?)(?=\[Page {page_num + 2}\]|\Z)'
    match = re.search(pattern, full_text, re.DOTALL)
    if match:
        return match.group(1).strip()
    
    # Fallback: split by page markers and index
    pages = re.split(r'\[Page \d+\]\n?', full_text)
    pages = [p.strip() for p in pages if p.strip()]
    if 0 <= page_num < len(pages):
        return pages[page_num]
    
    return ""


def count_pages_in_text(full_text: str) -> int:
    """Count how many pages are in the extracted text."""
    matches = re.findall(r'\[Page (\d+)\]', full_text)
    if matches:
        return max(int(m) for m in matches)
    return 1


# ============ MAIN GENERATION FUNCTIONS ============

async def generate_page_summary(
    page_text: str,
    page_num: int,
    total_pages: int,
    model: Optional[str] = None
) -> dict:
    """Generate a summary for a single page."""
    model = model or settings.openrouter_model
    if not page_text.strip():
        return {
            "page": page_num,
            "title": f"Page {page_num + 1}",
            "summary": "_This page appears to be empty or contains only figures/tables._",
            "key_concepts": [],
            "has_math": False,
            "has_figures": True,
            "generated_at": datetime.utcnow().isoformat(),
            "model": model
        }
    
    # Truncate if too long (keep ~4000 chars per page)
    if len(page_text) > 5000:
        page_text = page_text[:2500] + "\n...[content truncated]...\n" + page_text[-2500:]
    
    user_prompt = PAGE_SUMMARY_USER_PROMPT.format(
        page_num=page_num + 1,
        total_pages=total_pages,
        page_text=page_text
    )
    
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "PaperTree"
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": PAGE_SUMMARY_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2500,
                }
            )
            if response.status_code != 200:
                raise Exception(f"API error: {response.status_code} - {response.text}")
            
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            
            # Parse the response
            result = _parse_page_summary(content, page_num, model)
            return result
            
    except httpx.TimeoutException:
        raise Exception(f"Timeout generating summary for page {page_num + 1}")
    except Exception as e:
        print(f"Error generating page {page_num + 1}: {e}")
        raise


async def generate_paper_tldr(
    title: str,
    text_preview: str,
    model: Optional[str] = None
) -> str:
    """Generate a TL;DR for the entire paper."""
    model = model or settings.openrouter_model
    
    # Use first ~3000 chars for TL;DR
    if len(text_preview) > 4000:
        text_preview = text_preview[:4000]
    
    user_prompt = PAPER_TLDR_USER_PROMPT.format(
        title=title,
        text_preview=text_preview
    )
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "PaperTree"
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": PAPER_TLDR_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 300,
                }
            )
            
            if response.status_code != 200:
                raise Exception(f"API error: {response.status_code}")
            
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
            
    except Exception as e:
        print(f"Error generating TL;DR: {e}")
        return "Summary generation failed. Please try again."


async def generate_multiple_pages(
    full_text: str,
    total_pages: int,
    pages_to_generate: List[int],
    model: Optional[str] = None
) -> List[dict]:
    """Generate summaries for multiple pages."""
    results = []
    
    for page_num in pages_to_generate:
        if page_num < 0 or page_num >= total_pages:
            continue
            
        page_text = extract_page_text(full_text, page_num)
        
        try:
            summary = await generate_page_summary(
                page_text=page_text,
                page_num=page_num,
                total_pages=total_pages,
                model=model
            )
            results.append(summary)
        except Exception as e:
            print(f"Failed to generate page {page_num}: {e}")
            # Add error placeholder
            results.append({
                "page": page_num,
                "title": f"Page {page_num + 1}",
                "summary": f"_Failed to generate summary: {str(e)}_",
                "key_concepts": [],
                "has_math": False,
                "has_figures": False,
                "generated_at": datetime.utcnow().isoformat(),
                "model": model or settings.openrouter_model,
                "error": True
            })
    
    return results


# ============ LEGACY SUPPORT ============

async def generate_book_content(
    paper_text: str,
    page_count: int,
    title: str = "Untitled Paper",
    model: Optional[str] = None,
    default_pages: int = 5
) -> dict:
    """
    Generate book content with page-by-page summaries.
    By default, only generates first N pages.
    """
    model = model or settings.openrouter_model
    
    # Generate TL;DR first
    tldr = await generate_paper_tldr(title, paper_text[:6000], model)
    
    # Generate first N pages by default
    pages_to_generate = list(range(min(default_pages, page_count)))
    page_summaries = await generate_multiple_pages(
        full_text=paper_text,
        total_pages=page_count,
        pages_to_generate=pages_to_generate,
        model=model
    )
    
    # Build smart outline from page summaries
    smart_outline = []
    for ps in page_summaries:
        smart_outline.append({
            "id": f"page-{ps['page']}",
            "title": ps["title"],
            "level": 1,
            "section_id": f"page-{ps['page']}",
            "pdf_page": ps["page"],
            "description": ps["key_concepts"][0] if ps.get("key_concepts") else None
        })
    
    return {
        "title": title,
        "authors": None,
        "tldr": tldr,
        "sections": [],  # Legacy - empty
        "page_summaries": page_summaries,
        "summary_status": {
            "total_pages": page_count,
            "generated_pages": [ps["page"] for ps in page_summaries],
            "default_limit": default_pages
        },
        "key_figures": [],
        "generated_at": datetime.utcnow().isoformat(),
        "model": model
    }


# ============ PARSING HELPERS ============

def _parse_page_summary(content: str, page_num: int, model: str) -> dict:
    """Parse LLM response for page summary."""
    
    # Try direct JSON parse
    try:
        result = json.loads(content)
        return _validate_page_summary(result, page_num, model)
    except json.JSONDecodeError:
        pass
    
    # Try extracting JSON from markdown
    patterns = [
        r'```json\s*([\s\S]*?)\s*```',
        r'```\s*([\s\S]*?)\s*```',
        r'\{[\s\S]*\}'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, content)
        if match:
            try:
                json_str = match.group(1) if '```' in pattern else match.group(0)
                result = json.loads(json_str)
                return _validate_page_summary(result, page_num, model)
            except (json.JSONDecodeError, IndexError):
                continue
    
    # Fallback: use content as-is
    return {
        "page": page_num,
        "title": f"Page {page_num + 1}",
        "summary": content,
        "key_concepts": [],
        "has_math": "$" in content,
        "has_figures": "figure" in content.lower() or "```mermaid" in content,
        "generated_at": datetime.utcnow().isoformat(),
        "model": model
    }


def _validate_page_summary(result: dict, page_num: int, model: str) -> dict:
    """Validate and fix page summary structure."""
    return {
        "page": page_num,
        "title": result.get("title", f"Page {page_num + 1}"),
        "summary": result.get("summary", ""),
        "key_concepts": result.get("key_concepts", [])[:5],  # Max 5
        "has_math": result.get("has_math", False),
        "has_figures": result.get("has_figures", False),
        "generated_at": datetime.utcnow().isoformat(),
        "model": model
    }


# ============ HIGHLIGHT EXPLANATION (EXISTING) ============

async def generate_highlight_explanation(
    selected_text: str,
    question: str,
    context_before: str = "",
    context_after: str = "",
    model: Optional[str] = None
) -> str:
    """Generate explanation for a highlighted text selection."""
    model = model or settings.openrouter_model
    
    system_prompt = """You explain research paper content clearly and concisely.

Rules:
- Be direct and helpful
- Use LaTeX for math: $inline$ or $$display$$
- Use Mermaid for diagrams if helpful
- Keep explanations focused on the question
- Use analogies to clarify complex ideas"""
    
    user_prompt = f"""Help me understand this text from a research paper.

{f'Context: ...{context_before[-200:]}' if context_before else ''}

**Selected text:**
"{selected_text}"

{f'...{context_after[:200]}...' if context_after else ''}

**My question:** {question}

Give a clear, helpful explanation."""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "PaperTree"
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1500
                }
            )
            
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
            
    except Exception as e:
        raise Exception(f"Failed to generate explanation: {str(e)}")