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
    from tests.conftest import connect_mcp

    async with connect_mcp(create_mcp_server(ctx)) as session:
        await session.initialize()
        result = await session.call_tool(name, arguments)
        assert len(result.content) == 1, f"unexpected content blocks: {result}"
        return json.loads(result.content[0].text)


async def test_list_tools() -> None:
    from tests.conftest import connect_mcp

    async with connect_mcp(create_mcp_server(make_ctx())) as session:
        await session.initialize()
        listing = await session.list_tools()
        names = [t.name for t in listing.tools]
    assert set(names) == {
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


async def test_web_search_success() -> None:
    payload = await call_tool(make_ctx(), "web_search", {"query": "q", "max_results": 2})
    assert payload["success"] is True
    assert payload["query"] == "q"
    assert len(payload["results"]) == 2
    first = payload["results"][0]
    assert set(first) == {
        "title",
        "url",
        "snippet",
        "source",
        "source_domain",
        "confidence",
    }


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
        type(provider.results[0])(title="Bad", url="bad-url-no-scheme", snippet="", source="fake"),
    ]
    respx.get("https://ok.example.com/a").respond(200, html=PAGE_HTML)

    payload = await call_tool(ctx, "web_search_and_fetch", {"query": "q", "max_results": 5})
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


# ---------------------------------------------------------------------------
# Verification-protocol tools (V5) — these call the dashboard's claims API
# ---------------------------------------------------------------------------

CLAIM_STATE_BODY = {
    "success": True,
    "state": {
        "id": "EV-000001",
        "state": "SUPPORTED",
        "evidenceHash": "0xabc",
        "attestations": [],
        "challenges": [],
        "resolution": None,
        "challengeDeadline": 1788000000,
    },
}


@respx.mock
async def test_get_claim_state() -> None:
    respx.get("http://test:3000/api/claims/EV-000001").respond(200, json=CLAIM_STATE_BODY)
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(ctx, "get_claim_state", {"evidence_id": "EV-000001"})
    assert payload["success"] is True
    assert payload["state"]["state"] == "SUPPORTED"


@respx.mock
async def test_get_citation() -> None:
    respx.get("http://test:3000/api/claims/EV-000001/citation").respond(
        200,
        json={
            "success": True,
            "citation": {
                "claimId": "EV-000001",
                "claimText": "A claim",
                "evidence": [{"id": "ev:1", "sha256": "abc", "source": "https://a.com"}],
                "resolution": {"state": "RESOLVED", "result": True, "finalProbability": 0.9},
            },
        },
    )
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(ctx, "get_citation", {"evidence_id": "EV-000001"})
    assert payload["success"] is True
    assert payload["citation"]["claimId"] == "EV-000001"
    assert payload["citation"]["evidence"][0]["sha256"] == "abc"


@respx.mock
async def test_attest_claim_posts_to_dashboard() -> None:
    route = respx.post("http://test:3000/api/claims/EV-000001/attest").respond(
        200,
        json={"success": True, "state": {"id": "EV-000001", "state": "SUPPORTED", "attestations": 1}},
    )
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(
        ctx,
        "attest_claim",
        {
            "evidence_id": "EV-000001",
            "agent": "0x1234",
            "decision": "SUPPORTED",
            "confidence": 0.9,
            "stake": "100000000000000000000",
            "model": "gpt-4o",
            "search_provider": "bing",
            "sources": ["https://a.com"],
        },
    )
    assert payload["success"] is True
    sent = json.loads(route.calls.last.request.content)
    assert sent["model"] == "gpt-4o"
    assert sent["searchProvider"] == "bing"
    assert sent["sources"] == ["https://a.com"]


@respx.mock
async def test_challenge_claim_posts_to_dashboard() -> None:
    route = respx.post("http://test:3000/api/claims/EV-000001/challenge").respond(
        200,
        json={"success": True, "state": {"id": "EV-000001", "state": "CHALLENGED", "challenges": 1}},
    )
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(
        ctx,
        "challenge_claim",
        {"evidence_id": "EV-000001", "challenger": "0x9999", "bond": "100", "reason": "contradicts"},
    )
    assert payload["success"] is True
    sent = json.loads(route.calls.last.request.content)
    assert sent["challenger"] == "0x9999"
    assert sent["reason"] == "contradicts"


@respx.mock
async def test_attest_claim_wraps_dashboard_error() -> None:
    respx.post("http://test:3000/api/claims/EV-000001/attest").respond(
        409,
        json={"success": False, "error": {"type": "RENDER_FAILED", "message": "Cannot attest in state RESOLVED"}},
    )
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(
        ctx,
        "attest_claim",
        {"evidence_id": "EV-000001", "agent": "0x1234", "decision": "SUPPORTED", "confidence": 0.9, "stake": "100"},
    )
    assert payload["success"] is False
    assert "Cannot attest" in payload["error"]["message"]


@respx.mock
async def test_finalize_claim_posts_confirm() -> None:
    route = respx.post("http://test:3000/api/claims/EV-000001/finalize").respond(
        200,
        json={"success": True, "state": {"id": "EV-000001", "state": "RESOLVED", "anchored": True}},
    )
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(
        ctx,
        "finalize_claim",
        {"evidence_id": "EV-000001", "confirm": True, "scoring_rule": "log"},
    )
    assert payload["success"] is True
    sent = json.loads(route.calls.last.request.content)
    assert sent["confirm"] is True
    assert sent["scoringRule"] == "log"


@respx.mock
async def test_verify_claim_returns_verification() -> None:
    respx.get("http://test:3000/api/claims/EV-000001/verify").respond(
        200,
        json={
            "success": True,
            "verification": {
                "claimId": "EV-000001",
                "verified": True,
                "rootMatch": True,
                "onChainRoot": "0xabc",
                "localRoot": "0xabc",
            },
        },
    )
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(ctx, "verify_claim", {"evidence_id": "EV-000001"})
    assert payload["success"] is True
    assert payload["verification"]["verified"] is True
    assert payload["verification"]["rootMatch"] is True


@respx.mock
async def test_arbitrate_claim_posts_ruling() -> None:
    route = respx.post("http://test:3000/api/claims/EV-000001/arbitrate").respond(
        200,
        json={
            "success": True,
            "state": {
                "id": "EV-000001",
                "state": "RESOLVED",
                "resolution": {"method": "HUMAN_ARBITRATION", "tier": "L4_HUMAN_EXPERT", "result": True},
                "anchored": True,
            },
        },
    )
    ctx = make_ctx(Settings(log_level="ERROR", evidence_api_url="http://test:3000"))
    payload = await call_tool(
        ctx,
        "arbitrate_claim",
        {"evidence_id": "EV-000001", "expert": "0xfeed", "result": True, "rationale": "sources hold", "confirm": True},
    )
    assert payload["success"] is True
    sent = json.loads(route.calls.last.request.content)
    assert sent["result"] is True
    assert sent["expert"] == "0xfeed"
    assert sent["confirm"] is True
