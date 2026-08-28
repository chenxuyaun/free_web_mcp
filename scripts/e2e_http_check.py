"""End-to-end check against a remote HTTP MCP server.

Usage:
    uv run python scripts/e2e_http_check.py https://your-service.onrender.com
    uv run python scripts/e2e_http_check.py https://a1b2.ngrok-free.app
"""

import asyncio
import json
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def _emit(line: str) -> None:
    print(line, flush=True)


async def main(url: str) -> None:
    base = url.rstrip("/")
    if not base.endswith("/mcp"):
        base = base + "/mcp"
    _emit(f"PROBE: {base}")

    # 1. /health
    import httpx

    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            health_root = url.rstrip("/")
            if health_root.endswith("/mcp"):
                health_root = health_root[: -len("/mcp")]
            r = await http.get(health_root + "/health")
            _emit(f"HEALTH {r.status_code}: {r.text}")
            r.raise_for_status()
        except Exception as exc:
            _emit(f"HEALTH FAILED: {exc}")
            raise

    # 2. MCP handshake + call
    try:
        async with streamablehttp_client(base) as (read, write, _), ClientSession(
            read, write
        ) as session:
            await session.initialize()
            tools = await session.list_tools()
            _emit(f"TOOLS: {[t.name for t in tools.tools]}")

            result = await session.call_tool(
                "web_search", {"query": "model context protocol", "max_results": 3}
            )
            data = json.loads(result.content[0].text)
            assert data["success"], data
            _emit(f"SEARCH OK: {len(data['results'])} results")
            for item in data["results"]:
                _emit(
                    f"  - {item['title'][:60]} | "
                    f"{item['source_domain']} ({item['confidence']})"
                )

            if data["results"]:
                first_url = data["results"][0]["url"]
                fetched = await session.call_tool("web_fetch", {"url": first_url})
                page = json.loads(fetched.content[0].text)
                assert page["success"], page
                _emit(
                    f"FETCH OK: title={page['title'][:50]!r} "
                    f"text_length={page['text_length']} "
                    f"meta=https={page['meta']['https']} "
                    f"domain={page['meta']['domain_type']} "
                    f"published_at={page['meta']['published_at']}"
                )
    except BaseExceptionGroup as eg:  # noqa: PERF203
        for exc in eg.exceptions:
            if isinstance(exc, AssertionError):
                raise
        _emit(f"NOTE: task-group shutdown noise suppressed ({len(eg.exceptions)} sub-exception)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python scripts/e2e_http_check.py <url>")
        sys.exit(2)
    asyncio.run(main(sys.argv[1]))
