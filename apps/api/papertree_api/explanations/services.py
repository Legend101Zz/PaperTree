# apps/api/papertree_api/explanations/services.py
from typing import Optional

import httpx
from papertree_api.config import get_settings

settings = get_settings()


# Ask mode specific system prompts
ASK_MODE_PROMPTS = {
    "explain_simply": """You are an expert at explaining complex concepts simply. 
Break down the content using everyday language and relatable analogies.
Avoid jargon. Use short sentences. Make it accessible to a curious beginner.
Format your response in clear Markdown.""",

    "explain_math": """You are a mathematics professor explaining concepts rigorously.
Use proper mathematical notation with LaTeX (use $...$ for inline and $$...$$ for display equations).
Show equations, define variables, explain each step mathematically.
Be precise but clear about notation conventions.""",

    "derive_steps": """You are a meticulous tutor showing step-by-step derivations.
Number each step clearly. Show ALL intermediate steps.
Use LaTeX for equations: $...$ inline, $$...$$ for display.
Explain WHY each step follows from the previous.
Format as a numbered list with clear transitions.""",

    "intuition": """You are building intuition and mental models.
Focus on the "why" and the underlying principles.
Use analogies, thought experiments, and visual descriptions.
Help the reader develop a gut feeling for the concept.
Avoid heavy math notation unless essential.""",

    "pseudocode": """You are a programmer explaining algorithms.
Convert the concept into clear pseudocode or Python-like code.
Use code blocks with proper syntax highlighting.
Explain the logic flow and key data structures.
Include comments explaining each major step.""",

    "diagram": """You are a visual explainer creating diagrams.
Create a Mermaid diagram that captures the key relationships/flow.
Use appropriate diagram types (flowchart, sequence, class, state, etc.).
Wrap the diagram in ```mermaid code blocks.
Also provide a brief text explanation of what the diagram shows.""",

    "custom": """You are an expert research paper explainer.
Provide a clear, comprehensive explanation.
Use appropriate formatting (Markdown, LaTeX for math, Mermaid for diagrams).
Tailor your response to the specific question asked."""
}


def get_system_prompt(ask_mode: str) -> str:
    """Get system prompt based on ask mode."""
    base_prompt = ASK_MODE_PROMPTS.get(ask_mode, ASK_MODE_PROMPTS["custom"])
    
    return f"""{base_prompt}

IMPORTANT FORMATTING RULES:
- Use Markdown for structure (headers, lists, bold, etc.)
- For math: use $...$ for inline equations, $$...$$ for display equations
- For diagrams: use ```mermaid code blocks
- For code: use ```language code blocks
- Keep responses focused and well-organized
- Start with a brief TL;DR if the explanation is long"""


async def call_openrouter(
    selected_text: str,
    question: str,
    context_before: str = "",
    context_after: str = "",
    section_title: str = "",
    ask_mode: str = "explain_simply",
    model: Optional[str] = None
) -> str:
    """
    Call OpenRouter API to get AI explanation.
    """
    model = model or settings.openrouter_model
    
    system_prompt = get_system_prompt(ask_mode)

    user_prompt = f"""Please help me understand the following text from a research paper.

{f'**Section:** {section_title}' if section_title else ''}

{f'**Context before:** ...{context_before[-300:]}' if context_before else ''}

**Selected text:**
{selected_text}

{f'**Context after:** {context_after[:300]}...' if context_after else ''}

**My question:** {question}

Please provide your explanation following the formatting guidelines."""

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
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 3000
                }
            )
            
            response.raise_for_status()
            data = response.json()
            
            return data["choices"][0]["message"]["content"]
    
    except httpx.HTTPStatusError as e:
        raise Exception(f"OpenRouter API error: {e.response.text}")
    except Exception as e:
        raise Exception(f"Failed to call OpenRouter: {str(e)}")


async def summarize_thread(explanations: list) -> str:
    """
    Summarize an explanation thread.
    """
    # Build conversation context
    conversation = ""
    for exp in explanations:
        conversation += f"Q: {exp['question']}\nA: {exp['answer_markdown']}\n\n"
    
    system_prompt = """You are a helpful assistant. Summarize the following Q&A thread from a research paper reading session. 
Provide a concise summary that captures the key insights and learning points.
Use Markdown formatting. Include any important equations or diagrams if relevant."""

    user_prompt = f"""Please summarize this conversation thread:

{conversation}

Provide a brief summary of the key points discussed."""

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
                    "model": settings.openrouter_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.5,
                    "max_tokens": 1500
                }
            )
            
            response.raise_for_status()
            data = response.json()
            
            return data["choices"][0]["message"]["content"]
    
    except Exception as e:
        raise Exception(f"Failed to summarize: {str(e)}")