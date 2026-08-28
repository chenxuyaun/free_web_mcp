"""Multi-provider aggregation + HTML parser tests (M1A)."""

import pytest

from free_web_mcp.config import Settings
from free_web_mcp.errors import ToolError
from free_web_mcp.models.search import SearchResult
from free_web_mcp.web.providers.baidu import BaiduProvider
from free_web_mcp.web.providers.bing import BingProvider
from free_web_mcp.web.search import SearchService
from tests.conftest import FakeProvider


def make_result(url: str, source: str = "fake") -> SearchResult:
    return SearchResult(title=f"T {url}", url=url, snippet="s", source=source)


class FlakyProvider(FakeProvider):
    """Fails on the first N calls, then delegates to the real results."""

    def __init__(self, fail_times: int) -> None:
        super().__init__()
        self.fail_times = fail_times
        self.calls = 0

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise ToolError(503, "rate limited")
        return self.results[:max_results]


class _Settings(Settings):
    def __init__(self) -> None:
        super().__init__(log_level="ERROR", search_max_results=10)


async def test_fallback_on_primary_failure() -> None:
    flaky = FlakyProvider(fail_times=1)
    backup = FakeProvider()
    service = SearchService(
        settings=_Settings(),
        providers=[flaky, backup],
    )
    resp = await service.search("q", 3)
    assert len(resp.results) == 3
    assert flaky.calls == 1  # failed once, chain moved on to backup


async def test_all_providers_failing_raises_search_failed() -> None:
    class AlwaysFail(FakeProvider):
        async def search(self, query: str, max_results: int) -> list[SearchResult]:
            raise ToolError(503, "down")

    service = SearchService(provider=AlwaysFail(), settings=_Settings())
    with pytest.raises(ToolError) as excinfo:
        await service.search("q")
    assert excinfo.value.code == "SEARCH_FAILED"


BING_HTML = """
<html><body>
<ol id="b_results">
  <li class="b_algo"><h2><a href="https://a.example/1">First</a></h2>
    <div class="b_caption"><p>snippet one</p></div></li>
  <li class="b_algo"><h2><a href="https://b.example/2">Second</a></h2>
    <div class="b_caption"><p>snippet two</p></div></li>
  <li class="b_algo"><h2><a href="/relative">Skip me</a></h2></li>
</ol>
</body></html>
"""


def test_bing_parser() -> None:
    results = BingProvider._parse(BING_HTML, 5)
    assert len(results) == 2
    assert results[0].url == "https://a.example/1"
    assert results[0].title == "First"
    assert results[0].snippet == "snippet one"
    assert results[0].source == "bing"


BAIDU_HTML = """
<html><body>
<div class="result c-container" srcid="1599">
  <h3 class="c-title t t tts-title"><a href="http://www.baidu.com/link?url=x1">百度第一条</a></h3>
  <span class="content-right_8Zs40">这是摘要一</span>
</div>
<div class="result c-container">
  <h3><a href="https://direct.example/2">直连结果</a></h3>
  <span class="c-abstract">摘要二</span>
</div>
</body></html>
"""


def test_baidu_parser() -> None:
    results = BaiduProvider._parse(BAIDU_HTML, 5)
    assert len(results) == 2
    assert results[0].source == "baidu"
    assert results[0].title == "百度第一条"
    assert results[0].snippet == "这是摘要一"
    assert results[1].url == "https://direct.example/2"
