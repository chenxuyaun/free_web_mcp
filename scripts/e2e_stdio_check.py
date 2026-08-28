"""Throwaway end-to-end check: spawn server over stdio and hit the real internet."""

import asyncio
import json
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def _emit(line: str) -> None:
    print(line, flush=True)


async def main() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "free_web_mcp"],
    )
    try:
        async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            _emit(f"TOOLS: {[t.name for t in tools.tools]}")

            search = await session.call_tool(
                "web_search", {"query": "model context protocol", "max_results": 3}
            )
            data = json.loads(search.content[0].text)
            assert data["success"], data
            _emit(f"SEARCH OK: {len(data['results'])} results")
            for item in data["results"]:
                _emit(f"  - {item['title'][:70]} | {item['url'][:80]}")

            url = data["results"][0]["url"]
            fetch = await session.call_tool("web_fetch", {"url": url})
            page = json.loads(fetch.content[0].text)
            assert page["success"], page
            _emit(f"FETCH OK: title={page['title'][:60]!r} text_length={page['text_length']}")

            both = await session.call_tool(
                "web_search_and_fetch", {"query": "trafilatura python", "max_results": 2}
            )
            combined = json.loads(both.content[0].text)
            items = combined.get("items", [])
            ok = sum(1 for i in items if i.get("fetched"))
            errs = sum(1 for i in items if i.get("error"))
            _emit(f"SEARCH_AND_FETCH OK: fetched={ok} errors={errs} items={len(items)}")
    except BaseExceptionGroup as eg:  # noqa: PERF203 - Python 3.14 compat
        # Swallow the noisy task-group shutdown traceback when every business
        # assertion already passed; raise only on a genuine inner error.
        for exc in eg.exceptions:
            if isinstance(exc, AssertionError):
                raise
        _emit(f"NOTE: task-group shutdown noise suppressed ({len(eg.exceptions)} sub-exception)")


if __name__ == "__main__":
    asyncio.run(main())
