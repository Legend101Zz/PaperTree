import asyncio
import json
import os
from datetime import datetime
from functools import lru_cache
from typing import Any, AsyncGenerator, Dict, List, Optional

import httpx

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Model configurations
MODELS = {
    "deepseek/deepseek-v3.2": {
        "name": "DeepSeek V3",
        "cost_per_1k_input": 0.00014,
        "cost_per_1k_output": 0.00028,
        "max_context": 64000,
    },
    "anthropic/claude-sonnet-4.5": {
        "name": "Claude 3.5 Sonnet",
        "cost_per_1k_input": 3,
        "cost_per_1k_output": 10,
        "max_context": 200000,
    },
    "openai/gpt-5.2-chat": {
        "name": "GPT-4o Mini",
        "cost_per_1k_input": 1.75,
        "cost_per_1k_output": 14,
        "max_context": 128000,
    },
}

# Mode-specific prompts
MODE_PROMPTS = {
    "explain": """You are an expert academic tutor. Explain the following text clearly and concisely.
- Use simple language, avoid jargon
- Include relevant examples or analogies
- If math is involved, use LaTeX notation ($..$ for inline, $$...$$ for blocks)
- Keep response focused and under 300 words

Text to explain:
{text}

{context}""",

    "summarize": """Summarize the following text concisely:
- Capture the main point in 1-2 sentences
- List 3-5 key takeaways as bullet points
- Note any important caveats or limitations

Text:
{text}

{context}""",

    "critique": """Provide a critical analysis of the following text:
- Identify potential weaknesses or limitations
- Note any assumptions made
- Suggest alternative interpretations
- Rate confidence level (high/medium/low)

Text:
{text}

{context}""",

    "derive": """Derive or prove the following step-by-step:
- Start from first principles where possible
- Show each logical step clearly
- Use LaTeX for all mathematical notation
- Explain the intuition behind key steps

Content:
{text}

{context}""",

    "define": """Define the key terms and concepts in this text:
- Provide clear, concise definitions
- Include etymology if helpful
- Note related concepts
- Give examples of usage

Text:
{text}

{context}""",

    "diagram": """Create a Mermaid diagram representing the concepts in this text:
- Use appropriate diagram type (flowchart, mindmap, sequence, etc.)
- Keep it focused and readable
- Include a brief explanation

Return ONLY the mermaid code block, like:
```mermaid
...
```

Text:
{text}

{context}""",

    "related": """Based on this text, suggest related concepts to explore:
- List 5-7 related topics
- Briefly explain how each relates
- Suggest questions for deeper understanding

Text:
{text}

{context}""",

    "custom": """{custom_prompt}

Text:
{text}

{context}""",
}

class AIService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=60.0)
        self._request_cache: Dict[str, Any] = {}
    
    async def close(self):
        await self.client.aclose()
    
    def _build_prompt(
        self, 
        mode: str, 
        text: str, 
        context: str = "",
        custom_prompt: Optional[str] = None
    ) -> str:
        template = MODE_PROMPTS.get(mode, MODE_PROMPTS["explain"])
        
        context_str = f"\nAdditional context:\n{context}" if context else ""
        
        if mode == "custom" and custom_prompt:
            return template.format(
                text=text, 
                context=context_str,
                custom_prompt=custom_prompt
            )
        
        return template.format(text=text, context=context_str)
    
    def _generate_cache_key(self, model: str, prompt: str) -> str:
        import hashlib
        return hashlib.md5(f"{model}:{prompt}".encode()).hexdigest()
    
    async def generate(
        self,
        text: str,
        mode: str = "explain",
        context: str = "",
        custom_prompt: Optional[str] = None,
        model: str = "deepseek/deepseek-chat",
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """Generate AI response for given text and mode."""
        
        prompt = self._build_prompt(mode, text, context, custom_prompt)
        cache_key = self._generate_cache_key(model, prompt)
        
        # Check cache for idempotency
        if use_cache and cache_key in self._request_cache:
            return self._request_cache[cache_key]
        
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://papertree.app",
            "X-Title": "PaperTree",
        }
        
        payload = {
            "model": model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.7,
            "max_tokens": 2000,
        }
        
        try:
            response = await self.client.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            
            result = {
                "content": data["choices"][0]["message"]["content"],
                "model": model,
                "model_name": MODELS.get(model, {}).get("name", model),
                "tokens_used": data.get("usage", {}).get("total_tokens", 0),
                "prompt_tokens": data.get("usage", {}).get("prompt_tokens", 0),
                "completion_tokens": data.get("usage", {}).get("completion_tokens", 0),
                "cost_estimate": self._estimate_cost(model, data.get("usage", {})),
                "created_at": datetime.utcnow().isoformat(),
            }
            
            # Cache successful result
            if use_cache:
                self._request_cache[cache_key] = result
            
            return result
            
        except httpx.HTTPStatusError as e:
            raise Exception(f"AI API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise Exception(f"AI generation failed: {str(e)}")
    
    async def generate_stream(
        self,
        text: str,
        mode: str = "explain",
        context: str = "",
        custom_prompt: Optional[str] = None,
        model: str = "deepseek/deepseek-chat",
    ) -> AsyncGenerator[str, None]:
        """Stream AI response for real-time updates."""
        
        prompt = self._build_prompt(mode, text, context, custom_prompt)
        
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 2000,
            "stream": True,
        }
        
        async with self.client.stream(
            "POST",
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        content = chunk["choices"][0]["delta"].get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue
    
    async def parallel_generate(
        self,
        requests: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Run multiple AI queries in parallel."""
        tasks = [
            self.generate(
                text=req["text"],
                mode=req.get("mode", "explain"),
                context=req.get("context", ""),
                model=req.get("model", "deepseek/deepseek-chat"),
            )
            for req in requests
        ]
        return await asyncio.gather(*tasks, return_exceptions=True)
    
    def _estimate_cost(self, model: str, usage: Dict) -> float:
        model_info = MODELS.get(model, {})
        input_cost = (usage.get("prompt_tokens", 0) / 1000) * model_info.get("cost_per_1k_input", 0)
        output_cost = (usage.get("completion_tokens", 0) / 1000) * model_info.get("cost_per_1k_output", 0)
        return round(input_cost + output_cost, 6)


# Singleton instance
_ai_service: Optional[AIService] = None

def get_ai_service() -> AIService:
    global _ai_service
    if _ai_service is None:
        _ai_service = AIService()
    return _ai_service