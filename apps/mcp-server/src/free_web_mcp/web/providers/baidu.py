"""Baidu HTML search provider — no API key, parses www.baidu.com/s.

Baidu returns redirect links (www.baidu.com/link?url=...); we resolve them
best-effort via the WebClient (follows redirects) and fall back to the
redirect URL when resolution fails.
"""

import asyncio

from bs4 import BeautifulSoup

from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.logging import get_logger
from free_web_mcp.models.search import SearchResult
from free_web_mcp.web.client import WebClient

logger = get_logger(__name__)

MAX_REDIRECT_RESOLVES = 5


class BaiduProvider:
    name = "baidu"

    def __init__(self, client: WebClient) -> None:
        self.client = client

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        url = f"https://www.baidu.com/s?wd={query}&rn={max_results}"
        try:
            page = await self.client.get(url)
        except ToolError as exc:
            logger.warning("baidu search failed: %s", exc)
            raise ToolError(ErrorCode.SEARCH_FAILED, "Baidu search failed.") from exc

        html = page.content.decode("utf-8", errors="replace")
        parsed = self._parse(html, max_results)

        # Resolve Baidu redirect links to real URLs (best effort, top N only).
        resolved: list[SearchResult] = []
        for item in parsed:
            if item.url.startswith("http://www.baidu.com/link") or item.url.startswith(
                "https://www.baidu.com/link"
            ):
                real: str | None = None
                if len(resolved) < MAX_REDIRECT_RESOLVES:
                    real = await self._resolve(item.url)
                resolved.append(item.model_copy(update={"url": real or item.url}))
            else:
                resolved.append(item)
        return resolved

    async def _resolve(self, redirect_url: str) -> str | None:
        try:
            page = await asyncio.wait_for(self.client.get(redirect_url), timeout=8.0)
            return page.url
        except (TimeoutError, ToolError, Exception) as exc:  # noqa: BLE001
            logger.debug("baidu redirect resolve failed: %s", exc)
            return None

    @staticmethod
    def _parse(html: str, max_results: int) -> list[SearchResult]:
        soup = BeautifulSoup(html, "html.parser")
        results: list[SearchResult] = []
        for item in soup.select("div.result, div.c-container")[: max_results * 2]:
            anchor = item.select_one("h3 a[href], .c-title a[href]")
            if anchor is None:
                continue
            href = str(anchor.get("href") or "")
            title = anchor.get_text(strip=True)
            if not href.startswith("http") or not title:
                continue
            snippet_el = item.select_one(
                ".content-right_8Zs40, [class*='content-right'], .c-abstract, [class*='abstract']"
            )
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            results.append(
                SearchResult(title=title, url=href, snippet=snippet, source="baidu")
            )
            if len(results) >= max_results:
                break
        return results
