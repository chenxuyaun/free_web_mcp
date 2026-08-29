"""HTTP transport tests: /health, /.well-known/mcp.json, tool metadata."""

import httpx
import pytest

from free_web_mcp import __version__
from free_web_mcp.config import Settings
from free_web_mcp.deps import AppContext
from free_web_mcp.server import create_app


@pytest.fixture
def app() -> AppContext:
    ctx = AppContext.create(Settings(log_level="ERROR"))
    return create_app(ctx)


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        yield c


async def test_health_returns_version(client: httpx.AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "free-web-mcp"
    assert body["version"] == __version__


async def test_well_known_lists_all_four_tools(client: httpx.AsyncClient) -> None:
    r = await client.get("/.well-known/mcp.json")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "free-web-mcp"
    assert body["version"] == __version__
    assert body["transport"] == "streamable-http"
    assert body["endpoint"] == "/mcp"
    assert body["health"] == "/health"
    assert body["protocol_version"] == "2025-06-18"
    names = {t["name"] for t in body["tools"]}
    assert names == {
        "web_search",
        "web_fetch",
        "web_search_and_fetch",
        "web_summarize_with_sources",
        "extract_claims",
        "find_counter_evidence",
        "create_evidence_record",
        "get_evidence",
    }


async def test_well_known_tool_schemas_have_descriptions(client: httpx.AsyncClient) -> None:
    r = await client.get("/.well-known/mcp.json")
    body = r.json()
    for tool in body["tools"]:
        # title and description are both present and non-empty
        assert tool["title"], f"{tool['name']} missing title"
        assert tool["description"], f"{tool['name']} missing description"
        schema = tool["inputSchema"]
        assert schema["type"] == "object"
        # at least one property has a description
        props = schema.get("properties", {})
        assert props, f"{tool['name']} has no properties"
        assert any("description" in v for v in props.values()), (
            f"{tool['name']} parameters missing descriptions"
        )


async def test_well_known_annotations_mark_read_only_and_open_world(
    client: httpx.AsyncClient,
) -> None:
    r = await client.get("/.well-known/mcp.json")
    body = r.json()
    for tool in body["tools"]:
        ann = tool.get("annotations") or {}
        assert ann.get("readOnlyHint") is True, f"{tool['name']} not readOnlyHint"
        assert ann.get("openWorldHint") is True, f"{tool['name']} not openWorldHint"
        assert ann.get("destructiveHint") is False, f"{tool['name']} not non-destructive"


async def test_well_known_max_results_has_constraints(client: httpx.AsyncClient) -> None:
    r = await client.get("/.well-known/mcp.json")
    body = r.json()
    by_name = {t["name"]: t for t in body["tools"]}
    web_search_schema = by_name["web_search"]["inputSchema"]
    props = web_search_schema["properties"]
    assert props["max_results"]["minimum"] == 1
    assert props["max_results"]["maximum"] == 10
    assert "description" in props["max_results"]
    assert "description" in props["query"]
