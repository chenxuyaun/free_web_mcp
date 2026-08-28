"""Bing HTML search provider — no API key, parses www.bing.com/search."""

from typing import cast

from bs4 import BeautifulSoup

from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.logging import get_logger
from free_web_mcp.models.search import SearchResult
from free_web_mcp.web.client import WebClient

logger = get_logger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


class BingProvider:
    name = "bing"

    def __init__(self, client: WebClient) -> None:
        self.client = client

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        url = f"https://www.bing.com/search?q={query}&count={max_results}"
        try:
            page = await self.client.get(url)
        except ToolError as exc:
            logger.warning("bing search failed: %s", exc)
            raise ToolError(ErrorCode.SEARCH_FAILED, "Bing search failed.") from exc

        html = page.content.decode("utf-8", errors="replace")
        return self._parse(html, max_results)

    @staticmethod
    def _parse(html: str, max_results: int) -> list[SearchResult]:
        soup = BeautifulSoup(html, "html.parser")
        results: list[SearchResult] = []
        for item in soup.select("li.b_algo")[: max_results * 2]:
            anchor = item.select_one("h2 a[href]")
            if anchor is None:
                continue
            href = cast("str", anchor.get("href", "")).strip()
            title = anchor.get_text(strip=True)
            if not href.startswith("http"):
                continue
            snippet_el = item.select_one(".b_caption p, .b_lineclamp2, .b_lineclamp3")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            results.append(
                SearchResult(title=title, url=href, snippet=snippet, source="bing")
            )
            if len(results) >= max_results:
                break
        return results
