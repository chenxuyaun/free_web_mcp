"""HTML content extraction: trafilatura first, BeautifulSoup fallback."""

import io

from bs4 import BeautifulSoup
from trafilatura import extract as _trafilatura_extract

from free_web_mcp.errors import ErrorCode, ToolError

STRIPPED_TAGS = ("script", "style", "nav", "footer", "header", "aside", "form", "noscript")


def extract_title(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)
    return ""


def extract_main_text(html: str) -> str:
    """Extract clean main-article text without nav/footer/ads."""
    text = _trafilatura_extract(html, include_comments=False, favor_recall=True)
    if not text:
        text = _bs4_fallback(html)
    if not text.strip():
        raise ToolError(ErrorCode.PARSER_ERROR, "No readable content found on the page.")
    return text.strip()


def markdown_to_html_capable(html: str) -> bool:  # pragma: no cover - placeholder hook
    """Reserved: switch output to Markdown once v2 needs it."""
    return False


def _bs4_fallback(html: str) -> str:
    try:
        soup = BeautifulSoup(io.StringIO(html), "html.parser")
    except Exception as exc:  # malformed HTML beyond lxml recovery
        raise ToolError(ErrorCode.PARSER_ERROR, "Failed to parse the webpage.") from exc
    for tag in soup.find_all(list(STRIPPED_TAGS)):
        tag.decompose()
    return "\n".join(
        line.strip() for line in soup.get_text(separator="\n").splitlines() if line.strip()
    )
