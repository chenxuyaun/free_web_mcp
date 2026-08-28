"""Shared pytest fixtures - no real network anywhere."""

import os

# Keep settings deterministic regardless of developer .env
os.environ.setdefault("APP_ENV", "test")

import pytest

from free_web_mcp.config import Settings
from free_web_mcp.deps import AppContext
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
