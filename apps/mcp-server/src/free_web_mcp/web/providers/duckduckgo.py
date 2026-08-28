"""DuckDuckGo search provider built on the ddgs library (no API key needed)."""

import asyncio

from ddgs import DDGS
from ddgs.exceptions import DDGSException, RatelimitException, TimeoutException

from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.logging import get_logger
from free_web_mcp.models.search import SearchResult

logger = get_logger(__name__)


class DuckDuckGoProvider:
    name = "duckduckgo"

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        try:
            raw = await asyncio.to_thread(
                self._search_sync,
                query,
                max_results,
            )
        except RatelimitException as exc:
            raise ToolError(ErrorCode.RATE_LIMITED, "Search engine rate limit hit.") from exc
        except TimeoutException as exc:
            raise ToolError(ErrorCode.TIMEOUT, "Search engine timed out.") from exc
        except DDGSException as exc:
            logger.warning("duckduckgo search failed: %s", exc)
            raise ToolError(ErrorCode.SEARCH_FAILED, "Web search failed.") from exc

        return [
            SearchResult(
                title=item.get("title", ""),
                url=item.get("href", ""),
                snippet=item.get("body", ""),
                source=self.name,
            )
            for item in raw
        ]

    @staticmethod
    def _search_sync(query: str, max_results: int) -> list[dict[str, str]]:
        with DDGS() as ddgs:
            results = ddgs.text(query, max_results=max_results)
            return [dict(item) for item in results]
