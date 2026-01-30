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
    
    # OpenRouter
    openrouter_api_key: str = ""
    openrouter_model: str = "moonshotai/kimi-k2.5"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    
    # Storage
    storage_path: str = "storage/papers"
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()