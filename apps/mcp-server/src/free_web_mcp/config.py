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
    search_provider: str = "auto"  # auto | duckduckgo | bing | baidu

    render_enabled: bool = False
    render_timeout: int = 30
    render_max_bytes: int = 5_000_000

    # Evidence API (the Next.js dashboard owns evidence persistence)
    evidence_api_url: str = "http://127.0.0.1:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
