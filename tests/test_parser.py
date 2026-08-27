from free_web_mcp.errors import ToolError
from free_web_mcp.web.parser import extract_main_text, extract_title

HTML = """
<html><head><title>Example Page</title>
<style>body { color: red; }</style></head>
<body>
<nav>Navigation links</nav>
<script>alert('nope');</script>
<article><h1>Real Heading</h1>
<p>This is the main content of the article about free web search.</p>
<p>Second paragraph with more details.</p></article>
<footer>(c) Example Corp</footer>
</body></html>
"""


def test_extracts_title() -> None:
    assert extract_title(HTML) == "Example Page"


def test_main_text_contains_article_only() -> None:
    text = extract_main_text(HTML)
    assert "main content of the article" in text
    assert "Navigation links" not in text
    assert "(c) Example Corp" not in text
    assert "alert" not in text


def test_empty_page_raises_parser_error() -> None:
    try:
        extract_main_text("<html><body></body></html>")
    except ToolError as exc:
        assert exc.code == "PARSER_ERROR"
    else:
        raise AssertionError("expected PARSER_ERROR")
