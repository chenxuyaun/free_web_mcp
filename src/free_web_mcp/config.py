from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "free-web-mcp"
    app_env: str = "development"

    host: str = "0.0.0.0"
    port: int = 8000

    log_level: str = "INFO"

    http_timeout: int = 30
    max_content_length: int = 5_000_000

    search_max_results: int = 10


@lru_cache
def get_settings() -> Settings:
    return Settings()
