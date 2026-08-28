"""MCP tool registrations - tools only call the service layer."""

import json
from typing import Annotated, Any

from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field

from free_web_mcp import evidence as _evidence
from free_web_mcp.deps import AppContext
from free_web_mcp.errors import ErrorCode, ToolError, ToolErrorPayload
from free_web_mcp.evidence import EvidenceApiClient, counter_evidence_searches
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


# Tool-level annotation presets. readOnlyHint=True because none of these
# mutate server state; openWorldHint=True because every tool hits the
# public internet; destructiveHint=False for the same reason.
READ_OPEN = ToolAnnotations(
    readOnlyHint=True, openWorldHint=True, destructiveHint=False
)


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

    citations: list[str] = []
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
    @server.tool(
        name="web_search",
        title="Web Search",
        description=(
            "Search the web via DuckDuckGo (no API key required) and return a list of "
            "results. Each result carries a `source_domain` (e.g. `wikipedia.org`) and "
            "a `confidence` score in 0-1 reflecting ranking and authority hints "
            "(.gov / .edu / .int / .mil and a small allow-list of well-known domains). "
            "Use this when you need a quick list of sources for a query."
        ),
        annotations=READ_OPEN,
    )
    async def web_search(
        query: Annotated[str, Field(description="The search query string.")],
        max_results: Annotated[
            int,
            Field(
                ge=1,
                le=10,
                description="Maximum number of results to return (1-10).",
            ),
        ] = 5,
    ) -> dict[str, Any]:
        try:
            response: SearchResponse = await ctx.search.search(query, max_results)
            return {
                "success": True,
                "query": response.query,
                "results": [r.model_dump(mode="json") for r in response.results],
            }
        except ToolError as exc:
            return _error_payload(exc)

    @server.tool(
        name="web_fetch",
        title="Web Fetch",
        description=(
            "Fetch a webpage and extract its main readable content (trafilatura first, "
            "BeautifulSoup as fallback; script / style / nav / footer / ads stripped). "
            "Returns a `meta` block: `domain_type` (government / academic / news / docs / "
            "wiki / forum / blog / other), `https` (bool), `published_at` (ISO-8601 if a "
            "date was found in <meta> or JSON-LD, else null), `fetched_at` (ISO-8601), "
            "`author` (from <meta name='author'> or JSON-LD, else null), "
            "`content_length_raw` (raw HTTP body bytes). Set `rendered=true` to drive a "
            "headless Chromium (requires RENDER_ENABLED=true) for JS-heavy pages."
        ),
        annotations=READ_OPEN,
    )
    async def web_fetch(
        url: Annotated[
            str,
            Field(description="Absolute http:// or https:// URL to fetch."),
        ],
        rendered: Annotated[
            bool,
            Field(
                description="Drive a headless browser (requires RENDER_ENABLED=true).",
            ),
        ] = False,
    ) -> dict[str, Any]:
        try:
            page = await ctx.fetch.fetch(url, rendered=rendered)
            return {"success": True, **page.model_dump(mode="json")}
        except ToolError as exc:
            return _error_payload(exc)

    @server.tool(
        name="web_search_and_fetch",
        title="Search and Fetch",
        description=(
            "Combine web_search + web_fetch: search the web, then fetch and extract the "
            "main text of the Top-N result URLs in one round-trip. Per-item failures do "
            "not abort the batch; each item carries either `fetched` or `error`."
        ),
        annotations=READ_OPEN,
    )
    async def web_search_and_fetch(
        query: Annotated[str, Field(description="The search query string.")],
        max_results: Annotated[
            int,
            Field(
                ge=1,
                le=10,
                description="Maximum number of results to fetch (1-10).",
            ),
        ] = 5,
        rendered: Annotated[
            bool,
            Field(
                description="Drive a headless browser for each fetch (RENDER_ENABLED=true).",
            ),
        ] = False,
    ) -> dict[str, Any]:
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

    @server.tool(
        name="web_summarize_with_sources",
        title="Summarize with Source Classification",
        description=(
            "Given a page (URL or inline HTML), extract authors, citations, and every "
            "outgoing link, and classify each link as `primary` (same domain), "
            "`secondary` (.gov / .edu / .int / .mil / .ac. and academic publishers), or "
            "`tertiary` (social / aggregator: reddit, stackoverflow, medium, twitter, "
            "weibo, etc.). The `counts` field is the per-tier totals so the agent can "
            "weight citations without reading every link."
        ),
        annotations=READ_OPEN,
    )
    async def web_summarize_with_sources(
        url: Annotated[
            str | None,
            Field(
                description="Absolute URL to fetch. Provide either `url` or `html`, not both.",
            ),
        ] = None,
        html: Annotated[
            str | None,
            Field(description="Inline HTML to summarize. Provide either `url` or `html`."),
        ] = None,
        max_links: Annotated[
            int,
            Field(
                ge=1,
                le=200,
                description="Maximum number of link entries to return (1-200).",
            ),
        ] = 25,
    ) -> dict[str, Any]:
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

    @server.tool(
        name="extract_claims",
        title="Extract Claims",
        description=(
            "Split a block of text into individual claims and classify each as fact / "
            "event / number / date / relationship / opinion / inference. Deterministic "
            "rule-based extraction — no LLM. Use it to pick which claim to verify next."
        ),
        annotations=READ_OPEN,
    )
    async def extract_claims(
        text: Annotated[
            str,
            Field(description="The text to split into claims (any length)."),
        ],
    ) -> dict[str, Any]:
        try:
            claims = _evidence.extract_claims(text)
            return {
                "success": True,
                "count": len(claims),
                "claims": [
                    {"id": c.id, "text": c.text, "type": c.type} for c in claims
                ],
            }
        except ToolError as exc:
            return _error_payload(exc)

    @server.tool(
        name="find_counter_evidence",
        title="Find Counter Evidence",
        description=(
            "Generate counter-evidence search directions for a claim (fact-check, "
            "debunk, correction angles). Returns the searches to run with web_search — "
            "run them and pass contradicting results to create_evidence_record."
        ),
        annotations=READ_OPEN,
    )
    async def find_counter_evidence(
        claim: Annotated[str, Field(description="The claim to challenge.")],
    ) -> dict[str, Any]:
        try:
            searches = counter_evidence_searches(claim)
            return {"success": True, "claim": claim, "searches": searches}
        except ToolError as exc:
            return _error_payload(exc)

    @server.tool(
        name="create_evidence_record",
        title="Create Evidence Record",
        description=(
            "Build a verified evidence package from a claim plus its supporting / "
            "contradicting sources. The server computes the verification status, "
            "canonicalizes the package, and returns its SHA-256 hash. Requires the "
            "evidence API (dashboard) to be running."
        ),
        annotations=READ_OPEN,
    )
    async def create_evidence_record(
        claim: Annotated[str, Field(description="The claim being verified.")],
        supporting: Annotated[
            list[dict[str, str]],
            Field(
                default_factory=list,
                description=(
                    "Sources that support the claim. Each: {url, title, source_type, "
                    "published_at?, retrieved_at?, content_hash?}. source_type is one of "
                    "official/primary/major_media/professional/secondary/unknown/social."
                ),
            ),
        ],
        contradicting: Annotated[
            list[dict[str, str]],
            Field(
                default_factory=list,
                description="Sources that contradict the claim (same shape as supporting).",
            ),
        ],
        cross_verified: Annotated[
            bool, Field(description="Whether an independent cross-check was performed.")
        ] = False,
    ) -> dict[str, Any]:
        try:
            client = EvidenceApiClient(ctx.settings.evidence_api_url)
            result = client.create_evidence_record(
                claim=claim,
                claim_type="fact",
                supporting=supporting,
                contradicting=contradicting,
                counter_searches=counter_evidence_searches(claim),
                cross_verified=cross_verified,
            )
            return result
        except ToolError as exc:
            return _error_payload(exc)

    @server.tool(
        name="get_evidence",
        title="Get Evidence Record",
        description=(
            "Fetch a previously created evidence package by id (EV-XXXXXX), including "
            "its verification status, sources, and SHA-256 hash."
        ),
        annotations=READ_OPEN,
    )
    async def get_evidence(
        evidence_id: Annotated[
            str, Field(description="Evidence id in the form EV-XXXXXX.")
        ],
    ) -> dict[str, Any]:
        try:
            client = EvidenceApiClient(ctx.settings.evidence_api_url)
            return client.get_evidence(evidence_id)
        except ToolError as exc:
            return _error_payload(exc)
