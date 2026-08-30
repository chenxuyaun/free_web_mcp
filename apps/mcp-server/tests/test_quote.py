"""V21: extract_quote — automatic supporting-quote extraction (teacher §19-§22)."""

import json

import respx

from free_web_mcp.config import Settings
from free_web_mcp.deps import AppContext
from free_web_mcp.evidence import extract_quote
from tests.conftest import FakeProvider

PAGE = (
    "The company reported strong quarterly results today. "
    "Revenue reached 1.2 million dollars, a 15% increase over last year. "
    "The CEO said the growth was driven by new product launches. "
    "Analysts expect the trend to continue into next quarter."
)


def test_extract_quote_finds_the_relevant_sentence() -> None:
    quote = extract_quote(PAGE, "Revenue increased 15% year over year")
    assert quote is not None
    assert "1.2 million dollars" in quote
    assert "15%" in quote


def test_extract_quote_returns_none_when_unrelated() -> None:
    quote = extract_quote(PAGE, "Xylophone tariffs soared in Nairobi markets")
    assert quote is None


def test_extract_quote_caps_length() -> None:
    long_page = " ".join(
        ["This is a very long sentence with many words " * 3] * 3
    ) + " Revenue rose 15 percent according to the report. "
    quote = extract_quote(long_page, "Revenue rose 15 percent", max_chars=40)
    assert quote is not None
    assert len(quote) <= 40


def test_extract_quote_handles_chinese() -> None:
    zh_page = "公司今天发布了季报。营收达到一百二十万元，同比增长百分之十五。"
    quote = extract_quote(zh_page, "营收同比增长")
    assert quote is not None
    assert "十五" in quote or "一百二十万" in quote


def _make_ctx() -> AppContext:
    ctx = AppContext.create(Settings(log_level="ERROR"))
    ctx.search.provider = FakeProvider()
    return ctx


@respx.mock
async def test_extract_quote_mcp_tool() -> None:
    from free_web_mcp.mcp.server import create_mcp_server
    from tests.conftest import connect_mcp

    ctx = _make_ctx()
    async with connect_mcp(create_mcp_server(ctx)) as session:
        await session.initialize()
        result = await session.call_tool(
            "extract_quote",
            {"text": PAGE, "claim": "Revenue increased 15% year over year"},
        )
        assert len(result.content) == 1
        payload = json.loads(result.content[0].text)
        assert payload["success"] is True
        assert "1.2 million dollars" in payload["quote"]
