"""MCP-level tests through an in-memory client session."""

import json

import respx

from free_web_mcp.config import Settings
from free_web_mcp.deps import AppContext
from free_web_mcp.mcp.server import create_mcp_server
from tests.conftest import FakeProvider

PAGE_HTML = (
    "<html><head><title>T</title></head><body><article><p>Body text.</p></article></body></html>"
)


def make_ctx(settings: Settings | None = None) -> AppContext:
    ctx = AppContext.create(settings or Settings(log_level="ERROR", search_max_results=10))
    ctx.search.provider = FakeProvider()
    return ctx


async def call_tool(ctx: AppContext, name: str, arguments: dict[str, object]) -> dict[str, object]:
    from mcp.shared.memory import create_connected_server_and_client_session as connect

    server = create_mcp_server(ctx)
    async with connect(server._mcp_server) as session:
        await session.initialize()
        result = await session.call_tool(name, arguments)
        assert len(result.content) == 1, f"unexpected content blocks: {result}"
        return json.loads(result.content[0].text)


async def test_list_tools() -> None:
    from mcp.shared.memory import create_connected_server_and_client_session as connect

    server = create_mcp_server(make_ctx())
    async with connect(server._mcp_server) as session:
        await session.initialize()
        listing = await session.list_tools()
        names = [t.name for t in listing.tools]
    assert set(names) == {"web_search", "web_fetch", "web_search_and_fetch"}


async def test_web_search_success() -> None:
    payload = await call_tool(make_ctx(), "web_search", {"query": "q", "max_results": 2})
    assert payload["success"] is True
    assert payload["query"] == "q"
    assert len(payload["results"]) == 2
    first = payload["results"][0]
    assert set(first) == {"title", "url", "snippet", "source"}


@respx.mock
async def test_web_fetch_error_wrapped() -> None:
    payload = await call_tool(make_ctx(), "web_fetch", {"url": "not-a-url"})
    assert payload["success"] is False
    assert payload["error"]["type"] == "INVALID_URL"


@respx.mock
async def test_web_fetch_success() -> None:
    respx.get("https://example.com/page").respond(200, html=PAGE_HTML)
    payload = await call_tool(make_ctx(), "web_fetch", {"url": "https://example.com/page"})
    assert payload["success"] is True
    assert payload["title"] == "T"
    assert "Body text." in payload["content"]


@respx.mock
async def test_search_and_fetch_mixes_ok_and_failures() -> None:
    ctx = make_ctx()
    provider = ctx.search.provider
    assert isinstance(provider, FakeProvider)
    provider.results = [
        type(provider.results[0])(
            title="Good", url="https://ok.example.com/a", snippet="", source="fake"
        ),
        type(provider.results[0])(
            title="Bad", url="bad-url-no-scheme", snippet="", source="fake"
        ),
    ]
    respx.get("https://ok.example.com/a").respond(200, html=PAGE_HTML)

    payload = await call_tool(
        ctx, "web_search_and_fetch", {"query": "q", "max_results": 5}
    )
    assert payload["success"] is True
    assert payload["query"] == "q"
    ok_item, bad_item = payload["items"]
    assert ok_item["fetched"] is not None and ok_item["error"] is None
    assert bad_item["fetched"] is None
    assert bad_item["error"]["type"] == "INVALID_URL"


async def test_web_fetch_rendered_routes_to_render_client() -> None:
    """rendered=True must dispatch through RenderClient, not WebClient."""
    from free_web_mcp.web.client import PageContent
    from tests.test_render import FakeRenderClient

    rendered_html = (
        "<html><head><title>SPA</title></head>"
        "<body><article><p>Hello from a headless browser.</p></article></body></html>"
    )
    ctx = make_ctx(Settings(log_level="ERROR", render_enabled=True))
    ctx.search.provider = FakeProvider()
    ctx.fetch.render = FakeRenderClient(
        page=PageContent(
            url="https://spa.example.com/",
            status_code=200,
            content=rendered_html.encode(),
            content_type="text/html",
        )
    )

    payload = await call_tool(
        ctx, "web_fetch", {"url": "https://spa.example.com/", "rendered": True}
    )
    assert payload["success"] is True
    assert payload["title"] == "SPA"
    assert "Hello from a headless browser." in payload["content"]
    assert ctx.fetch.render.calls == [("https://spa.example.com/", True)]  # type: ignore[attr-defined]


async def test_web_fetch_rendered_disabled_returns_error() -> None:
    ctx = make_ctx(Settings(log_level="ERROR", render_enabled=False))
    ctx.search.provider = FakeProvider()

    payload = await call_tool(
        ctx, "web_fetch", {"url": "https://spa.example.com/", "rendered": True}
    )
    assert payload["success"] is False
    assert payload["error"]["type"] == "RENDER_FAILED"
