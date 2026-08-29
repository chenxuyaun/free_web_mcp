"""Shared pytest fixtures - no real network anywhere."""

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from mcp import ClientSession
from mcp.server.models import InitializationOptions
from mcp.shared.memory import create_client_server_memory_streams

# Keep settings deterministic regardless of developer .env
os.environ.setdefault("APP_ENV", "test")

import pytest

from free_web_mcp.config import Settings
from free_web_mcp.deps import AppContext
from free_web_mcp.mcp.server import MCPServer
from free_web_mcp.models.search import SearchResult


class FakeProvider:
    name = "fake"

    def __init__(self, results: list[SearchResult] | None = None) -> None:
        self.results = results if results is not None else self._default_results()
        self.calls: list[tuple[str, int]] = []

    @staticmethod
    def _default_results() -> list[SearchResult]:
        return [
            SearchResult(
                title=f"Result {i}",
                url=f"https://example.com/{i}",
                snippet=f"snip {i}",
                source="fake",
            )
            for i in range(10)
        ]

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        self.calls.append((query, max_results))
        return self.results[:max_results]


@pytest.fixture
def settings() -> Settings:
    return Settings(log_level="ERROR", search_max_results=10)


@pytest.fixture
def ctx(settings: Settings) -> AppContext:
    context = AppContext.create(settings)
    yield context


# ---------- MCP SDK 2.x in-memory session helper ----------


@asynccontextmanager
async def connect_mcp(server: MCPServer) -> AsyncIterator[ClientSession]:
    """Run an MCPServer over in-memory streams and yield a connected client
    session (replaces the removed create_connected_server_and_client_session)."""
    async with create_client_server_memory_streams() as (client_streams, server_streams):
        server_task = asyncio.create_task(
            server._lowlevel_server.run(
                server_streams[0],
                server_streams[1],
                InitializationOptions(
                    server_name="free-web-mcp",
                    server_version="0.4.0",
                    capabilities={},
                ),
            )
        )
        try:
            async with ClientSession(*client_streams) as session:
                await session.initialize()
                yield session
        finally:
            server_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await server_task
