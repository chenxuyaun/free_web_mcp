"""v3 tests: meta extraction, source_domain / confidence, summarize-with-sources."""

import json

import respx

from free_web_mcp.config import Settings
from free_web_mcp.deps import AppContext
from free_web_mcp.mcp.server import create_mcp_server
from free_web_mcp.web.client import WebClient
from free_web_mcp.web.fetch import FetchService
from free_web_mcp.web.search import SearchService, _compute_confidence, _extract_source_domain
from tests.conftest import FakeProvider

HTML_WITH_META = """
<html>
<head>
<title>Old Page</title>
<meta name="author" content="Alice Author">
<meta property="article:published_time" content="2024-01-15T10:00:00Z">
<meta property="og:type" content="article">
</head>
<body>
<article>
<p>An article from 2024 about a recurring policy debate in federal regulation.</p>
</article>
</body>
</html>
"""

HTML_HTTP_NEWS = """
<html>
<head><title>News</title></head>
<body><p>Some news body from a major outlet.</p></body>
</html>
"""


async def test_extract_source_domain_basic() -> None:
    assert _extract_source_domain("https://www.Example.com/path") == "example.com"
    assert _extract_source_domain("https://news.bbc.co.uk/x") == "news.bbc.co.uk"
    assert _extract_source_domain("not-a-url") == ""


async def test_compute_confidence_ordering() -> None:
    # First-place plain > last-place plain.
    assert _compute_confidence(0, 3, "example.com") > _compute_confidence(2, 3, "example.com")
    # Authority boost raises the floor noticeably.
    assert _compute_confidence(2, 3, "example.gov") > _compute_confidence(2, 3, "example.com")
    # All outputs in range.
    for c in [
        _compute_confidence(0, 3, "example.com"),
        _compute_confidence(0, 3, "example.gov"),
        _compute_confidence(2, 3, "example.com"),
    ]:
        assert 0.0 <= c <= 1.0


async def test_search_result_has_source_domain_and_confidence() -> None:
    provider = FakeProvider()
    provider.results = [
        type(provider.results[0])(
            title="x", url="https://www.Example.com/a", snippet="", source="fake"
        ),
        type(provider.results[0])(
            title="y", url="https://example.com/b", snippet="", source="fake"
        ),
        type(provider.results[0])(
            title="z", url="https://example.gov/c", snippet="", source="fake"
        ),
    ]
    service = SearchService(provider=provider, settings=Settings(log_level="ERROR"))
    response = await service.search("q", 3)
    domains = [r.source_domain for r in response.results]
    assert domains == ["example.com", "example.com", "example.gov"]
    confidences = [r.confidence for r in response.results]
    # Top > middle; authority boost on the last lifts it above the non-authority middle.
    assert confidences[0] > confidences[1] > 0.0
    assert confidences[2] > confidences[1]


@respx.mock
async def test_fetch_service_includes_meta() -> None:
    respx.get("https://example.com/post").respond(200, html=HTML_WITH_META)
    settings = Settings(log_level="ERROR")
    service = FetchService(WebClient(settings), settings)
    page = await service.fetch("https://example.com/post")
    meta = page.meta
    assert meta.https is True
    assert meta.author == "Alice Author"
    assert meta.published_at is not None
    assert meta.published_at.startswith("2024-01-15")
    assert meta.content_length_raw > 0
    assert meta.fetched_at  # ISO timestamp is non-empty
    # domain_type is a small heuristic; just assert it's a known bucket.
    assert meta.domain_type in {
        "government",
        "academic",
        "news",
        "docs",
        "wiki",
        "forum",
        "blog",
        "other",
    }


@respx.mock
async def test_fetch_service_classifies_https_news() -> None:
    respx.get("http://news.bbc.co.uk/x").respond(200, html=HTML_HTTP_NEWS)
    settings = Settings(log_level="ERROR")
    service = FetchService(WebClient(settings), settings)
    page = await service.fetch("http://news.bbc.co.uk/x")
    assert page.meta.https is False
    assert page.meta.domain_type == "news"


# ---- MCP end-to-end -------------------------------------------------------

PAGE_HTML = (
    "<html><head><title>T</title></head><body><article><p>Body text.</p></article></body></html>"
)


def make_ctx(settings: Settings | None = None) -> AppContext:
    ctx = AppContext.create(settings or Settings(log_level="ERROR", search_max_results=10))
    ctx.search.provider = FakeProvider()
    return ctx


async def call_tool(ctx: AppContext, name: str, arguments: dict[str, object]) -> dict[str, object]:
    from tests.conftest import connect_mcp

    async with connect_mcp(create_mcp_server(ctx)) as session:
        await session.initialize()
        result = await session.call_tool(name, arguments)
        assert len(result.content) == 1
        return json.loads(result.content[0].text)


@respx.mock
async def test_web_fetch_returns_meta_block() -> None:
    respx.get("https://example.com/page").respond(200, html=HTML_WITH_META)
    payload = await call_tool(make_ctx(), "web_fetch", {"url": "https://example.com/page"})
    assert payload["success"] is True
    assert "meta" in payload
    assert payload["meta"]["author"] == "Alice Author"
    assert payload["meta"]["https"] is True
    assert payload["meta"]["content_length_raw"] > 0
    assert payload["meta"]["fetched_at"]


@respx.mock
async def test_web_summarize_with_sources_by_url() -> None:
    html = """
    <html>
    <head>
      <title>Article with links</title>
      <meta name="author" content="Alice">
      <script type="application/ld+json">
        {"@type": "Article", "author": {"@type": "Person", "name": "Bob"}}
      </script>
    </head>
    <body>
      <article>
        <p>See <a href="https://example.com/internal">internal</a> and
           <a href="https://www.nature.com/paper">nature</a> and
           <a href="https://reddit.com/r/x">reddit</a></p>
        <blockquote cite="https://www.bbc.com/news/x">quoted text</blockquote>
      </article>
    </body>
    </html>
    """
    respx.get("https://example.com/article").respond(200, html=html)

    payload = await call_tool(
        make_ctx(),
        "web_summarize_with_sources",
        {"url": "https://example.com/article", "max_links": 50},
    )
    assert payload["success"] is True
    assert "Alice" in payload["authors"]
    assert "Bob" in payload["authors"]
    assert any("bbc.com" in c for c in payload["citations"])
    # Links classification
    links_by_domain = {link["domain"]: link for link in payload["links"]}
    assert links_by_domain["example.com"]["tier"] == "primary"
    assert links_by_domain["nature.com"]["tier"] == "secondary"
    assert links_by_domain["reddit.com"]["tier"] == "tertiary"
    assert payload["counts"]["primary"] >= 1
    assert payload["counts"]["tertiary"] >= 1


async def test_web_summarize_with_sources_by_html() -> None:
    html = (
        "<html><body>"
        '<a href="https://example.com/a">a</a>'
        '<a href="https://www.Example.com/b">b</a>'
        '<a href="https://stackoverflow.com/q">q</a>'
        "</body></html>"
    )
    payload = await call_tool(
        make_ctx(),
        "web_summarize_with_sources",
        {"html": html, "max_links": 10},
    )
    assert payload["success"] is True
    assert payload["url"] == "inline://html"
    # Inline mode has no base host; non-aggregator links default to secondary.
    tiers = [link["tier"] for link in payload["links"]]
    assert "tertiary" in tiers  # stackoverflow
    assert "secondary" in tiers  # example.com links
    assert payload["counts"]["tertiary"] >= 1


@respx.mock
async def test_web_summarize_with_sources_primary_when_same_domain() -> None:
    html = (
        "<html><body>"
        '<a href="https://example.com/x">x</a>'
        '<a href="https://other.com/y">y</a>'
        "</body></html>"
    )
    respx.get("https://example.com/post").respond(200, html=html)
    payload = await call_tool(
        make_ctx(),
        "web_summarize_with_sources",
        {"url": "https://example.com/post"},
    )
    assert payload["success"] is True
    by_domain = {link["domain"]: link for link in payload["links"]}
    assert by_domain["example.com"]["tier"] == "primary"
    assert by_domain["other.com"]["tier"] == "secondary"


async def test_web_summarize_with_sources_needs_input() -> None:
    payload = await call_tool(make_ctx(), "web_summarize_with_sources", {})
    assert payload["success"] is False
    assert payload["error"]["type"] == "INVALID_URL"


async def test_web_summarize_with_sources_max_links_caps() -> None:
    html = (
        "<html><body>"
        + "".join(f'<a href="https://other.com/{i}">x{i}</a>' for i in range(40))
        + "</body></html>"
    )
    payload = await call_tool(
        make_ctx(),
        "web_summarize_with_sources",
        {"html": html, "max_links": 5},
    )
    assert payload["success"] is True
    assert len(payload["links"]) == 5
