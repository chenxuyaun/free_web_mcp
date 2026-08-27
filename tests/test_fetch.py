import httpx
import pytest
import respx

from free_web_mcp.errors import ToolError
from free_web_mcp.web.client import WebClient
from free_web_mcp.web.fetch import FetchService

PAGE_HTML = """<html><head><title>Doc</title></head>
<body><article><p>Hello fetchable world.</p></article></body></html>"""


@pytest.fixture
def client(settings) -> WebClient:
    return WebClient(settings)


@respx.mock
async def test_get_success(client: WebClient) -> None:
    route = respx.get("https://example.com/ok").respond(200, html=PAGE_HTML)
    page = await client.get("https://example.com/ok")
    assert route.called
    assert page.status_code == 200


@respx.mock
async def test_http_error_mapped(client: WebClient) -> None:
    respx.get("https://example.com/missing").respond(404, text="nope")
    with pytest.raises(ToolError) as excinfo:
        await client.get("https://example.com/missing")
    assert excinfo.value.code == "HTTP_ERROR"


@respx.mock
async def test_timeout_mapped(client: WebClient) -> None:
    respx.get("https://example.com/slow").mock(side_effect=httpx.ConnectTimeout("too slow"))
    with pytest.raises(ToolError) as excinfo:
        await client.get("https://example.com/slow")
    assert excinfo.value.code == "TIMEOUT"


@respx.mock
async def test_content_too_large(settings) -> None:
    respx.get("https://example.com/big").respond(200, content=b"x" * 5_000_001)
    client = WebClient(settings)
    with pytest.raises(ToolError) as excinfo:
        await client.get("https://example.com/big")
    assert excinfo.value.code == "CONTENT_TOO_LARGE"


async def test_invalid_url_rejected(client: WebClient) -> None:
    with pytest.raises(ToolError) as excinfo:
        await client.get("not-a-url")
    assert excinfo.value.code == "INVALID_URL"


async def test_non_http_scheme_rejected(client: WebClient) -> None:
    with pytest.raises(ToolError) as excinfo:
        await client.get("ftp://example.com/file")
    assert excinfo.value.code == "INVALID_URL"


@respx.mock
async def test_fetch_service_extracts_page(settings) -> None:
    respx.get("https://example.com/page").respond(200, html=PAGE_HTML)
    service = FetchService(WebClient(settings), settings)
    fetched = await service.fetch("https://example.com/page")
    assert fetched.title == "Doc"
    assert "Hello fetchable world." in fetched.content
    assert fetched.text_length == len(fetched.content)
