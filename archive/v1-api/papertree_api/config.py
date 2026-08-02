from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # MongoDB
    mongo_uri: str = "mongodb://localhost:27017"
    database_name: str = "papertree"
    
    # JWT
    jwt_secret: str = "your-super-secret-jwt-key"
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24 * 7  # 1 week
    
    # LLM backend. MiniMax since 2026-07-31; OpenRouter before that.
    #
    # The endpoint is OpenAI-compatible (`{base}/chat/completions`, `Authorization: Bearer`),
    # which is the same shape every call site already used, so switching backends is a change
    # of VALUES rather than of code.
    #
    # Both default to M3, which handles text and vision. `llm_vision_model` stays a SEPARATE
    # setting even though the two values are currently equal, because the failure it prevents is
    # silent: only M3 accepts an image block (M2.7/M2.5/M2.1/M2 are text-and-tool-calls only),
    # and the previous default `deepseek/deepseek-v3.2` was a text model that would accept a
    # vision call's shape and return confident nonsense. Anyone who later downgrades `llm_model`
    # for cost has to make a deliberate second decision about vision rather than breaking it.
    llm_api_key: str = ""
    llm_model: str = "MiniMax-M3"
    llm_vision_model: str = "MiniMax-M3"
    llm_base_url: str = "https://api.minimax.io/v1"
    
    # Storage
    storage_path: str = "storage/papers"
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()