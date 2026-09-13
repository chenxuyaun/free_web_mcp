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
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
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
        "extract_quote",
        "create_evidence_record",
        "get_evidence",
        "get_claim_state",
        "get_citation",
        "attest_claim",
        "challenge_claim",
        "finalize_claim",
        "verify_claim",
        "arbitrate_claim",
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
    # Protocol write tools submit attestations/challenges to the dashboard
    # API — they are not read-only (but still non-destructive, open-world).
    write_tools = {"attest_claim", "challenge_claim", "finalize_claim", "arbitrate_claim"}
    for tool in body["tools"]:
        ann = tool.get("annotations") or {}
        expected_ro = tool["name"] not in write_tools
        assert ann.get("readOnlyHint") is expected_ro, (
            f"{tool['name']} readOnlyHint = {ann.get('readOnlyHint')}, expected {expected_ro}"
        )
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


# ── API key gate (measured exposure: the public URL accepted anonymous tools/call) ──

@pytest.fixture
def keyed_app() -> AppContext:
    return create_app(AppContext.create(Settings(log_level="ERROR", mcp_api_key="s3cret-key")))


@pytest.fixture
async def keyed_client(keyed_app):
    transport = httpx.ASGITransport(app=keyed_app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        yield c


async def test_keyed_server_rejects_anonymous_mcp_calls(keyed_client: httpx.AsyncClient) -> None:
    r = await keyed_client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"


async def test_keyed_server_rejects_a_wrong_key(keyed_client: httpx.AsyncClient) -> None:
    r = await keyed_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"X-API-Key": "wrong"},
    )
    assert r.status_code == 401


async def test_keyed_server_accepts_the_key_by_header_or_bearer(keyed_client: httpx.AsyncClient) -> None:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "t", "version": "1"},
        },
    }
    for headers in ({"X-API-Key": "s3cret-key"}, {"Authorization": "Bearer s3cret-key"}):
        r = await keyed_client.post("/mcp", json=body, headers=headers)
        # The gate is what is under test here; a successful handshake also needs the MCP
        # session manager's lifespan, which ASGITransport does not run.
        assert r.status_code != 401, f"{headers} should pass the gate"


async def test_health_stays_open_on_a_keyed_server(keyed_client: httpx.AsyncClient) -> None:
    r = await keyed_client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_unkeyed_server_is_not_gated(client: httpx.AsyncClient) -> None:
    r = await client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "t", "version": "1"},
            },
        },
    )
    # No key configured = no gate (the 127.0.0.1 dev case). The handshake itself needs the MCP
    # lifespan, which ASGITransport does not run — the gate is what this asserts.
    assert r.status_code != 401
