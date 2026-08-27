"""Search provider abstraction - swap engines without touching MCP layer."""

from typing import Protocol, runtime_checkable

from free_web_mcp.models.search import SearchResult


@runtime_checkable
class SearchProvider(Protocol):
    name: str

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        """Run a web search and return up to max_results results."""
        ...
