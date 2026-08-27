"""SearchService - orchestration of the pluggable provider."""

from free_web_mcp.config import Settings, get_settings
from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.models.search import SearchResponse, SearchResult
from free_web_mcp.web.providers import DuckDuckGoProvider


class SearchService:
    def __init__(
        self,
        provider: DuckDuckGoProvider | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.provider = provider or DuckDuckGoProvider()
        self.settings = settings or get_settings()

    def _clamp(self, max_results: int) -> int:
        return max(1, min(max_results, self.settings.search_max_results))

    async def search(self, query: str, max_results: int | None = None) -> SearchResponse:
        limit = self._clamp(max_results or 5)
        try:
            results: list[SearchResult] = await self.provider.search(query, limit)
        except ToolError:
            raise
        except Exception as exc:  # never let a raw provider exception escape
            raise ToolError(ErrorCode.SEARCH_FAILED, "Web search failed.") from exc
        return SearchResponse(query=query, results=results)
