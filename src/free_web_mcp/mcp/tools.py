"""MCP tool registrations - tools only call the service layer."""

from typing import Any

from mcp.server.fastmcp import FastMCP

from free_web_mcp.deps import AppContext
from free_web_mcp.errors import ErrorCode, ToolError, ToolErrorPayload
from free_web_mcp.logging import get_logger
from free_web_mcp.models.page import SearchAndFetchResponse, SearchPageItem
from free_web_mcp.models.search import SearchResponse

logger = get_logger(__name__)


def _error_payload(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, ToolError):
        payload = ToolErrorPayload(type=exc.code, message=exc.message)
    else:
        logger.exception("unexpected tool failure")
        payload = ToolErrorPayload(type=ErrorCode.SEARCH_FAILED, message="Internal error.")
    return {"success": False, "error": payload.model_dump(mode="json")}


def register_tools(server: FastMCP, ctx: AppContext) -> None:
    @server.tool()
    async def web_search(query: str, max_results: int = 5) -> dict[str, Any]:
        """Search the web and return a list of results (title/url/snippet)."""
        try:
            response: SearchResponse = await ctx.search.search(query, max_results)
            return {
                "success": True,
                "query": response.query,
                "results": [r.model_dump(mode="json") for r in response.results],
            }
        except ToolError as exc:
            return _error_payload(exc)

    @server.tool()
    async def web_fetch(url: str, rendered: bool = False) -> dict[str, Any]:
        """Fetch a webpage and extract its main readable content.

        Set rendered=True to drive a headless browser (requires RENDER_ENABLED=true)."""
        try:
            page = await ctx.fetch.fetch(url, rendered=rendered)
            return {"success": True, **page.model_dump(mode="json")}
        except ToolError as exc:
            return _error_payload(exc)

    @server.tool()
    async def web_search_and_fetch(
        query: str, max_results: int = 5, rendered: bool = False
    ) -> dict[str, Any]:
        """Search the web, then fetch and extract text from each result URL.

        Set rendered=True to drive a headless browser (requires RENDER_ENABLED=true)."""
        try:
            search_response = await ctx.search.search(query, max_results)
            items: list[SearchPageItem] = []
            for result in search_response.results:
                try:
                    page = await ctx.fetch.fetch(result.url, rendered=rendered)
                    items.append(SearchPageItem(search=result, fetched=page))
                except ToolError as exc:
                    items.append(
                        SearchPageItem(
                            search=result,
                            error=ToolErrorPayload(type=exc.code, message=exc.message),
                        )
                    )
            response = SearchAndFetchResponse(query=search_response.query, items=items)
            return response.model_dump(mode="json")
        except ToolError as exc:
            return _error_payload(exc)
