"""Rendered fetch path: no real browser in tests - all paths via fake clients."""

import sys

import pytest

from free_web_mcp.config import Settings
from free_web_mcp.errors import ToolError
from free_web_mcp.web.client import PageContent, WebClient
from free_web_mcp.web.fetch import FetchService
from free_web_mcp.web.render import RenderClient

PAGE_HTML = (
    "<html><head><title>Rendered Doc</title></head>"
    "<body><article><p>JS-rendered article body.</p></article></body></html>"
)


class FakeRenderClient:
    def __init__(self, page: PageContent | None = None, exc: Exception | None = None) -> None:
        default = PageContent(
            url="https://example.com/",
            status_code=200,
            content=PAGE_HTML.encode(),
            content_type="text/html",
        )
        self.page = page or default
        self.exc = exc
        self.calls: list[tuple[str, bool]] = []

    async def get(self, url: str) -> PageContent:
        self.calls.append((url, True))
        if self.exc:
            raise self.exc
        return self.page

    async def aclose(self) -> None:
        pass


def make_settings(**overrides) -> Settings:
    base = dict(log_level="ERROR", render_enabled=True, render_timeout=30)
    base.update(overrides)
    return Settings(**base)


async def test_rendered_false_keeps_http_path() -> None:
    settings = make_settings()
    service = FetchService(WebClient(settings), settings, render=FakeRenderClient())
    # No respx mock - if we hit the network the test will fail loudly.
    with pytest.raises(ToolError):
        await service.fetch("not-a-url")
    # Confirm the render path wasn't even consulted.
    assert service.render is not None
    assert getattr(service.render, "calls", []) == []  # type: ignore[attr-defined]


async def test_rendered_true_uses_render_client() -> None:
    settings = make_settings()
    fake = FakeRenderClient()
    service = FetchService(WebClient(settings), settings, render=fake)
    page = await service.fetch("https://example.com/", rendered=True)
    assert page.title == "Rendered Doc"
    assert "JS-rendered article body." in page.content
    assert fake.calls == [("https://example.com/", True)]


async def test_render_disabled_short_circuits() -> None:
    settings = make_settings(render_enabled=False)
    service = FetchService(WebClient(settings), settings, render=FakeRenderClient())
    with pytest.raises(ToolError) as excinfo:
        await service.fetch("https://example.com/", rendered=True)
    assert excinfo.value.code == "RENDER_FAILED"


async def test_render_exception_mapped_to_codes() -> None:
    settings = make_settings()
    cases = [
        (ToolError("RENDER_TIMEOUT", "slow"), "RENDER_TIMEOUT"),
        (ToolError("CONTENT_TOO_LARGE", "big"), "CONTENT_TOO_LARGE"),
        (ToolError("RENDER_FAILED", "boom"), "RENDER_FAILED"),
    ]
    for exc, expected in cases:
        service = FetchService(WebClient(settings), settings, render=FakeRenderClient(exc=exc))
        with pytest.raises(ToolError) as excinfo:
            await service.fetch("https://example.com/", rendered=True)
        assert excinfo.value.code == expected


async def test_real_render_client_refuses_when_disabled() -> None:
    settings = make_settings(render_enabled=False)
    client = RenderClient(settings)
    with pytest.raises(ToolError) as excinfo:
        await client.get("https://example.com/")
    assert excinfo.value.code == "RENDER_FAILED"


async def test_real_render_client_import_failure_is_caught(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If playwright is somehow not importable, the module must still load."""
    settings = make_settings(render_enabled=True)
    client = RenderClient(settings)
    # Hide any preloaded playwright modules so the lazy import inside
    # RenderClient._ensure_started hits ImportError.
    for name in list(sys.modules):
        if name == "playwright" or name.startswith("playwright."):
            monkeypatch.delitem(sys.modules, name)
    monkeypatch.setitem(sys.modules, "playwright.async_api", None)  # type: ignore[arg-type]

    with pytest.raises(ToolError) as excinfo:
        await client.get("https://example.com/")
    assert excinfo.value.code == "RENDER_FAILED"
    assert "Playwright" in excinfo.value.message


async def test_real_render_client_rejects_non_http() -> None:
    settings = make_settings()
    client = RenderClient(settings)
    with pytest.raises(ToolError) as excinfo:
        await client.get("ftp://example.com/")
    assert excinfo.value.code == "INVALID_URL"
