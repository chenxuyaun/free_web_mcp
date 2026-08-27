import pytest

from free_web_mcp.errors import ToolError
from free_web_mcp.web.search import SearchService
from tests.conftest import FakeProvider


def make_service(results_count: int = 10, search_max_results: int = 10):
    provider = FakeProvider()
    provider.results = provider.results[:results_count]

    from free_web_mcp.config import Settings

    settings = Settings(log_level="ERROR", search_max_results=search_max_results)
    return SearchService(provider=provider, settings=settings), provider


async def test_returns_results() -> None:
    service, _ = make_service(results_count=5)
    response = await service.search("test query", 5)
    assert response.query == "test query"
    assert len(response.results) == 5


async def test_clamps_to_configured_limit() -> None:
    service, provider = make_service(search_max_results=3)
    await service.search("q", 50)
    assert provider.calls[0][1] == 3


async def test_min_one_result() -> None:
    service, provider = make_service()
    await service.search("q", -1)
    assert provider.calls[0][1] == 1


async def test_provider_error_propagates_as_tool_error() -> None:
    class BrokenProvider(FakeProvider):
        async def search(self, query: str, max_results: int):
            raise RuntimeError("boom")

    from free_web_mcp.config import Settings

    service = SearchService(provider=BrokenProvider(), settings=Settings(log_level="ERROR"))
    with pytest.raises(ToolError) as excinfo:
        await service.search("q")
    assert excinfo.value.code == "SEARCH_FAILED"
