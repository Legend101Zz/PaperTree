# apps/api/papertree_api/papers/llm_service.py
"""
LLM service for generating book-style explanations of papers.
"""

import json
import re
import uuid
from typing import List, Optional, Tuple

import httpx
from papertree_api.config import get_settings

settings = get_settings()


SYSTEM_PROMPT = """You are a world-class science communicator and academic tutor, capable of explaining the most complex topics using the "Feynman Technique". Your goal is to transform dense academic research into an engaging, "book-style" learning experience.

### RESPONSE FORMAT
You must respond with valid, parseable JSON. Do not include markdown formatting (like ```json) outside the JSON structure.

### CONTENT GUIDELINES
1. **Tone:** Conversational, enthusiastic, and clear. Avoid jargon where possible; define it where necessary.
2. **Structure:** Break the paper into logical "Chapters" (sections).
3. **Analogies:** Use real-world analogies to explain abstract concepts.
4. **Visuals:** - Use Mermaid JS for process flows or system architectures.
   - Wrap Mermaid code in ```mermaid ... ``` blocks.
5. **Math:** - Use LaTeX for equations. 
   - CRITICAL: You must escape backslashes in the JSON string. 
   - Example: write "$\\alpha$" as "${\\alpha}$" (double backslash).

### JSON SCHEMA
{
  "title": "Engaging Title (not just the paper title)",
  "authors": "Author names",
  "tldr": "A 3-sentence hook: What is this, why does it matter, and what did they find?",
  "sections": [
    {
      "id": "sec_1",
      "title": "Chapter Title",
      "level": 1,
      "content": "Markdown text here. Use headers (##) for subsections. **Bold** for emphasis.",
      "pdf_pages": [0, 1], 
      "figures": ["Figure 1"]
    }
  ],
  "key_figures": [
    {"id": "fig1", "caption": "Simplified explanation of the figure", "pdf_page": 3}
  ]
}"""

USER_PROMPT_TEMPLATE = """Transform the following research paper into a structured "mini-book".

Paper Text:
---
{paper_text}
---

Total Pages: {page_count}

### INSTRUCTIONS
Create a response with exactly these 5 sections (map them to the 'sections' array in JSON):

1. **The Hook & Context:** Start with the problem. Why was this research needed? What was the status quo?
2. **Core Concepts:** Explain the fundamental theory or definitions needed to understand the work (Mental Models).
3. ** The Methodology (The "How"):** How did they do it? Use a **Mermaid Flowchart** here to visualize their pipeline/process.
4. **Key Results:** What actually happened? Use bullet points and context.
5. **Implications:** Why should the reader care? What is the future impact?

**CRITICAL FORMATTING RULES:**
- Escape all double quotes inside strings (e.g., \\").
- Escape all LaTeX backslashes (e.g., use $$\\sum$$ instead of $\sum$).
- Do not output any text before or after the JSON object.
"""

USER_PROMPT_TEMPLATE = """Create a book-style explanation of this research paper.

Paper text:
---
{paper_text}
---

The paper has {page_count} pages.

Create a comprehensive explanation with:
1. Clear TL;DR
2. Background/motivation
3. Methodology explained simply
4. Results with context
5. Implications and limitations

Use LaTeX for math: $x^2$ for inline, $$\\sum_{{i=1}}^n x_i$$ for display
Use Mermaid for helpful diagrams.
Reference original figures as [Figure X].
Map each section to approximate PDF page numbers (0-indexed).

Respond ONLY with valid JSON, no other text."""


async def generate_book_content(
    paper_text: str,
    page_count: int,
    model: Optional[str] = None
) -> dict:
    """Generate book-style content for a paper using LLM."""
    model = model or settings.openrouter_model
    
    print(f"Using model: {model}")
    print(f"OpenRouter base URL: {settings.openrouter_base_url}")
    print(f"API key present: {bool(settings.openrouter_api_key)}")
    
    # Truncate text if too long
    max_chars = 60000
    if len(paper_text) > max_chars:
        # Keep beginning and end
        half = max_chars // 2
        paper_text = paper_text[:half] + "\n\n[... content truncated for length ...]\n\n" + paper_text[-half:]
        print(f"Truncated text to {len(paper_text)} chars")
    
    user_prompt = USER_PROMPT_TEMPLATE.format(
        paper_text=paper_text,
        page_count=page_count
    )
    
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            print("Sending request to OpenRouter...")
            
            request_body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.7,
                "max_tokens": 8000,
            }
            
            response = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "PaperTree"
                },
                json=request_body
            )
            
            print(f"Response status: {response.status_code}")
            
            if response.status_code != 200:
                error_text = response.text
                print(f"API Error: {error_text}")
                raise Exception(f"OpenRouter API error: {response.status_code} - {error_text}")
            
            data = response.json()
            
            if "choices" not in data or len(data["choices"]) == 0:
                print(f"Unexpected response format: {data}")
                raise Exception("No choices in response")
            
            content = data["choices"][0]["message"]["content"]
            print(f"Raw content length: {len(content)}")
            print(f"Content preview: {content[:500]}...")
            
            # Try to parse JSON
            result = _parse_llm_response(content, model)
            return result
            
    except httpx.TimeoutException:
        print("Request timed out")
        raise Exception("Request timed out. The paper may be too long.")
    except httpx.RequestError as e:
        print(f"Request error: {e}")
        raise Exception(f"Network error: {str(e)}")
    except Exception as e:
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        raise


def _parse_llm_response(content: str, model: str) -> dict:
    """Parse LLM response, handling various formats."""
    
    # First, try direct JSON parse
    try:
        result = json.loads(content)
        return _validate_and_fix_result(result, model)
    except json.JSONDecodeError:
        pass
    
    # Try to extract JSON from markdown code blocks
    json_patterns = [
        r'```json\s*([\s\S]*?)\s*```',
        r'```\s*([\s\S]*?)\s*```',
        r'\{[\s\S]*\}'
    ]
    
    for pattern in json_patterns:
        match = re.search(pattern, content)
        if match:
            try:
                json_str = match.group(1) if '```' in pattern else match.group(0)
                result = json.loads(json_str)
                return _validate_and_fix_result(result, model)
            except (json.JSONDecodeError, IndexError):
                continue
    
    # Fallback: create minimal structure from content
    print("Failed to parse JSON, using fallback")
    return _create_fallback_content(content, model)


def _validate_and_fix_result(result: dict, model: str) -> dict:
    """Validate and fix the result structure."""
    
    # Ensure required fields
    if "title" not in result:
        result["title"] = "Untitled Paper"
    
    if "tldr" not in result:
        result["tldr"] = "Summary not available."
    
    if "sections" not in result or not result["sections"]:
        result["sections"] = [{
            "id": "section-1",
            "title": "Content",
            "level": 1,
            "content": "Content extraction failed. Please try again.",
            "pdf_pages": [0],
            "figures": []
        }]
    
    # Fix sections
    for i, section in enumerate(result["sections"]):
        if "id" not in section:
            section["id"] = f"section-{i+1}-{uuid.uuid4().hex[:6]}"
        if "title" not in section:
            section["title"] = f"Section {i+1}"
        if "level" not in section:
            section["level"] = 1
        if "content" not in section:
            section["content"] = ""
        if "pdf_pages" not in section:
            section["pdf_pages"] = [0]
        if "figures" not in section:
            section["figures"] = []
    
    if "key_figures" not in result:
        result["key_figures"] = []
    
    result["model"] = model
    
    return result


def _create_fallback_content(content: str, model: str) -> dict:
    """Create fallback content when JSON parsing fails."""
    
    # Try to extract meaningful sections from the content
    sections = []
    
    # Split by common section markers
    parts = re.split(r'\n(?=#{1,3}\s|\*\*[A-Z])', content)
    
    for i, part in enumerate(parts):
        if part.strip():
            # Try to extract title
            title_match = re.match(r'^#{1,3}\s*(.+?)(?:\n|$)', part)
            if title_match:
                title = title_match.group(1).strip()
                content_text = part[title_match.end():].strip()
            else:
                title = f"Section {i+1}"
                content_text = part.strip()
            
            sections.append({
                "id": f"section-{i+1}",
                "title": title,
                "level": 1,
                "content": content_text,
                "pdf_pages": [0],
                "figures": []
            })
    
    if not sections:
        sections = [{
            "id": "section-1",
            "title": "Paper Explanation",
            "level": 1,
            "content": content,
            "pdf_pages": [0],
            "figures": []
        }]
    
    return {
        "title": "Paper Analysis",
        "authors": None,
        "tldr": sections[0]["content"][:500] + "..." if sections else "Summary not available.",
        "sections": sections,
        "key_figures": [],
        "model": model
    }


async def generate_section_explanation(
    section_text: str,
    context: str,
    question: Optional[str] = None,
    model: Optional[str] = None
) -> str:
    """Generate explanation for a specific section or answer a question."""
    model = model or settings.openrouter_model
    
    prompt = f"""Context from paper:
{context[:2000]}

Section to explain:
{section_text}

{"Question: " + question if question else "Please explain this section clearly."}

Use LaTeX for math ($inline$ or $$display$$) and Mermaid for diagrams if helpful."""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You are a helpful tutor explaining academic papers. Use LaTeX for math and Mermaid for diagrams."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2000
                }
            )
            
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
            
    except Exception as e:
        raise Exception(f"Failed to generate explanation: {str(e)}")