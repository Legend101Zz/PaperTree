from typing import Optional

import httpx
from papertree_api.config import get_settings

settings = get_settings()


async def call_openrouter(
    selected_text: str,
    question: str,
    context_before: str = "",
    context_after: str = "",
    section_title: str = "",
    model: Optional[str] = None
) -> str:
    """
    Call OpenRouter API to get AI explanation.
    """
    model = model or settings.openrouter_model
    
    # Build the prompt
    system_prompt = """You are an expert research paper explainer. Your task is to help readers understand complex academic content.

When explaining:
1. Start with a brief TL;DR (one sentence summary)
2. Provide a clear, intuitive explanation
3. Use analogies when helpful
4. If mathematical, explain the intuition behind formulas
5. Keep explanations concise but thorough

Format your response in Markdown."""

    user_prompt = f"""Please help me understand the following text from a research paper.

{f'Section: {section_title}' if section_title else ''}

{f'Context before: ...{context_before}' if context_before else ''}

**Selected text:**
{selected_text}

{f'Context after: {context_after}...' if context_after else ''}

**Question:** {question}"""

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
                    "max_tokens": 2000
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
Provide a concise summary that captures the key insights and learning points."""

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
                    "max_tokens": 1000
                }
            )
            
            response.raise_for_status()
            data = response.json()
            
            return data["choices"][0]["message"]["content"]
    
    except Exception as e:
        raise Exception(f"Failed to summarize: {str(e)}")