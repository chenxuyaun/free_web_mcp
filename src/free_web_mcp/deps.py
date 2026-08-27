"""Dependency container shared by both stdio and HTTP transports."""

from dataclasses import dataclass
from functools import lru_cache

from free_web_mcp.config import Settings, get_settings
from free_web_mcp.web.client import WebClient
from free_web_mcp.web.fetch import FetchService
from free_web_mcp.web.search import SearchService


@dataclass
class AppContext:
    settings: Settings
    client: WebClient
    search: SearchService
    fetch: FetchService

    @classmethod
    def create(cls, settings: Settings | None = None) -> "AppContext":
        s = settings or get_settings()
        client = WebClient(s)
        return cls(
            settings=s,
            client=client,
            search=SearchService(settings=s),
            fetch=FetchService(client, s),
        )

    async def aclose(self) -> None:
        await self.client.aclose()


@lru_cache
def get_context() -> AppContext:
    return AppContext.create()
