"""MCP tool registrations - tools only call the service layer."""

import json
from typing import Any

from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP

from free_web_mcp.deps import AppContext
from free_web_mcp.errors import ErrorCode, ToolError, ToolErrorPayload
from free_web_mcp.logging import get_logger
from free_web_mcp.models.page import (
    SearchAndFetchResponse,
    SearchPageItem,
    SourceLink,
    SourceSummary,
)
from free_web_mcp.models.search import SearchResponse

logger = get_logger(__name__)

# Heuristic allow-lists for one/two/three-tier classification.
_TERTIARY_DOMAIN_HINTS = (
    "reddit.com",
    "stackoverflow.com",
    "stackexchange.com",
    "zhihu.com",
    "quora.com",
    "medium.com",
    "substack.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "baidu.com",
    "weibo.com",
)
_AUTHORITATIVE_TLDS = (".gov", ".edu", ".int", ".mil", ".ac.")


def _error_payload(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, ToolError):
        payload = ToolErrorPayload(type=exc.code, message=exc.message)
    else:
        logger.exception("unexpected tool failure")
        payload = ToolErrorPayload(type=ErrorCode.INTERNAL_ERROR, message="Internal error.")
    return {"success": False, "error": payload.model_dump(mode="json")}


def _classify_link_tier(href: str, primary_host: str) -> str:
    from urllib.parse import urlparse

    host = (urlparse(href).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return "tertiary"
    if host == primary_host:
        return "primary"
    if any(host.endswith(tld) for tld in _AUTHORITATIVE_TLDS):
        return "secondary"
    if any(hint in host for hint in _TERTIARY_DOMAIN_HINTS):
        return "tertiary"
    return "secondary"


def _summarize_sources(html: str, base_url: str) -> SourceSummary:
    from urllib.parse import urlparse

    soup = BeautifulSoup(html, "html.parser")
    base_host = (urlparse(base_url).hostname or "").lower()
    if base_host.startswith("www."):
        base_host = base_host[4:]

    authors: list[str] = []
    citations: list[str] = []

    # Authors: meta tags first, then JSON-LD.
    for key in ("author", "DC.creator", "article:author", "twitter:creator"):
        tag = soup.find("meta", attrs={"name": key}) or soup.find(
            "meta", attrs={"property": key}
        )
        if tag and tag.get("content"):
            v = str(tag["content"]).strip()
            if v and v not in authors:
                authors.append(v)
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except (ValueError, TypeError):
            continue
        for name in _walk_jsonld(data, "author"):
            if isinstance(name, str) and name and name not in authors:
                authors.append(name)
            elif isinstance(name, dict):
                name_value: object = name.get("name") or name.get("@value")
                if isinstance(name_value, str) and name_value and name_value not in authors:
                    authors.append(name_value)

    # Citations: <cite> + <blockquote cite="..."> + <q cite="...">
    for tag in soup.find_all(["cite", "blockquote", "q"]):
        cite_attr = tag.get("cite")
        if isinstance(cite_attr, str) and cite_attr.strip():
            v = cite_attr.strip()
            if v not in citations:
                citations.append(v)
        text = tag.get_text(strip=True)
        if text and tag.name == "cite" and text not in citations:
            citations.append(text[:500])

    # Links.
    seen: set[str] = set()
    links: list[SourceLink] = []
    for a in soup.find_all("a", href=True):
        href = str(a["href"]).strip()
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        if href in seen:
            continue
        seen.add(href)
        text = a.get_text(strip=True)[:200]
        domain = (urlparse(href).hostname or "").lower()
        if domain.startswith("www."):
            domain = domain[4:]
        links.append(
            SourceLink(
                href=href,
                text=text,
                domain=domain,
                tier=_classify_link_tier(href, base_host),
            )
        )

    counts: dict[str, int] = {"primary": 0, "secondary": 0, "tertiary": 0}
    for link in links:
        counts[link.tier] = counts.get(link.tier, 0) + 1

    return SourceSummary(
        url=base_url,
        authors=authors,
        citations=citations,
        links=links,
        counts=counts,
    )


def _walk_jsonld(node: object, key: str) -> list[object]:
    out: list[object] = []
    if isinstance(node, dict):
        if key in node:
            out.append(node[key])
        for v in node.values():
            out.extend(_walk_jsonld(v, key))
    elif isinstance(node, list):
        for v in node:
            out.extend(_walk_jsonld(v, key))
    return out


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

    @server.tool()
    async def web_summarize_with_sources(
        url: str | None = None,
        html: str | None = None,
        max_links: int = 25,
    ) -> dict[str, Any]:
        """Extract authors, citations and links from a page; classify each link
        as primary (same domain), secondary (gov/edu/int), or tertiary
        (aggregator / social). The agent decides what to trust."""
        try:
            if url is None and html is None:
                raise ToolError(ErrorCode.INVALID_URL, "Provide either url or html.")
            if url is not None:
                raw = await ctx.client.get(url)
                source_url = raw.url
                source_html = raw.content.decode("utf-8", errors="replace")
            else:
                assert html is not None
                source_url = "inline://html"
                source_html = html
            summary = _summarize_sources(source_html, source_url)
            summary.links = summary.links[: max(1, max_links)]
            return {"success": True, **summary.model_dump(mode="json")}
        except ToolError as exc:
            return _error_payload(exc)
