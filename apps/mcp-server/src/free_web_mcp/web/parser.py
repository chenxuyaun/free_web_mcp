"""HTML content extraction: trafilatura first, BeautifulSoup fallback.
Plus a metadata extractor for source provenance signals.
"""

import io
import json
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

from bs4 import BeautifulSoup
from trafilatura import extract as _trafilatura_extract

from free_web_mcp.errors import ErrorCode, ToolError

STRIPPED_TAGS = ("script", "style", "nav", "footer", "header", "aside", "form", "noscript")

# Highest-priority first: OpenGraph > JSON-LD > plain meta tags.
_PUBLISHED_META_KEYS = (
    ("property", "article:published_time"),
    ("property", "og:published_time"),
    ("name", "pubdate"),
    ("name", "date"),
    ("name", "DC.date.issued"),
    ("itemprop", "datePublished"),
    ("property", "release_date"),
    ("name", "parsely-pub-date"),
)

_AUTHOR_META_KEYS = (
    ("property", "article:author"),
    ("name", "author"),
    ("name", "DC.creator"),
    ("property", "book:author"),
    ("name", "twitter:creator"),
)

# Heuristic suffixes for domain_type classification.
_GOV_TLDS = (".gov", ".gov.cn", ".gov.uk", ".mil")
_EDU_TLDS = (".edu", ".edu.cn", ".ac.uk")
_NEWS_HINTS = ("nytimes", "bbc", "reuters", "xinhuanet", "people.com.cn", "theguardian")
_WIKI_HINTS = ("wikipedia.org", "wikimedia.org", "mediawiki.org")
_DOCS_HINTS = ("docs.", "developer.", "/docs/", "readthedocs", "gitbook")
_FORUM_HINTS = ("reddit.com", "stackoverflow", "stackexchange", "v2ex", "zhihu.com", "quora")
_BLOG_HINTS = ("medium.com", "substack.com", "wordpress", "blog.", "/blog/", "ghost.io")


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


def extract_metadata(html: str) -> tuple[str | None, str | None]:
    """Best-effort extraction of (author, published_at) from a single
    BeautifulSoup parse. Returns (None, None) on miss — never raises.
    """
    soup = BeautifulSoup(html, "html.parser")
    author = _first_meta(soup, _AUTHOR_META_KEYS) or _jsonld_first(soup, "author")
    published = _first_meta(soup, _PUBLISHED_META_KEYS) or _jsonld_first(soup, "datePublished")
    return _clean(author), _normalize_date(published)


def classify_domain(host: str, html: str) -> str:
    """Advisory, heuristic. Always returns a value; defaults to "other"."""
    h = (host or "").lower()
    if not h:
        return "other"
    if any(h.endswith(tld) or h.endswith(tld.replace(".", "")) for tld in _GOV_TLDS):
        return "government"
    if any(h.endswith(tld) for tld in _EDU_TLDS):
        return "academic"
    soup = BeautifulSoup(html, "html.parser")
    og_tag = soup.find("meta", attrs={"property": "og:type"})
    og_type = og_tag["content"] if og_tag and og_tag.get("content") else ""
    if og_type in ("article", "news"):
        if any(hint in h for hint in _NEWS_HINTS):
            return "news"
        if any(hint in h for hint in _WIKI_HINTS):
            return "wiki"
        if any(hint in h for hint in _DOCS_HINTS):
            return "docs"
    if any(hint in h for hint in _WIKI_HINTS):
        return "wiki"
    if any(hint in h for hint in _DOCS_HINTS):
        return "docs"
    if any(hint in h for hint in _NEWS_HINTS):
        return "news"
    if any(hint in h for hint in _FORUM_HINTS):
        return "forum"
    if any(hint in h for hint in _BLOG_HINTS):
        return "blog"
    return "other"


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


def _first_meta(soup: BeautifulSoup, candidates: tuple[tuple[str, str], ...]) -> str | None:
    for attr, key in candidates:
        tag = soup.find("meta", attrs={attr: key})
        if tag is None:
            continue
        content = tag.get("content")
        if content:
            return str(content).strip()
    return None


def _jsonld_first(soup: BeautifulSoup, key: str) -> str | None:
    """Walk all JSON-LD blocks; return the first value found for the given key,
    tolerating malformed blocks and `@graph`/array-of-types containers.
    """
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except (ValueError, TypeError):
            continue
        found = _walk_jsonld(data, key)
        if found:
            return found
    return None


def _walk_jsonld(node: object, key: str) -> str | None:
    if isinstance(node, dict):
        if key in node:
            value = node[key]
            if isinstance(value, str) and value:
                return value
            if isinstance(value, list) and value:
                first = value[0]
                if isinstance(first, str) and first:
                    return first
                if isinstance(first, dict):
                    nested = _walk_jsonld(first, key)
                    if nested:
                        return nested
        for v in node.values():
            nested = _walk_jsonld(v, key)
            if nested:
                return nested
    elif isinstance(node, list):
        for v in node:
            nested = _walk_jsonld(v, key)
            if nested:
                return nested
    return None


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    s = value.strip()
    # Try ISO-8601 with trailing Z.
    if s.endswith("Z"):
        s_iso = s[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(s_iso).astimezone(UTC).isoformat()
        except ValueError:
            pass
    # ISO-8601 already.
    try:
        return datetime.fromisoformat(s).astimezone(UTC).isoformat()
    except ValueError:
        pass
    # RFC 2822 (HTTP date / email date).
    try:
        return parsedate_to_datetime(s).astimezone(UTC).isoformat()
    except (TypeError, ValueError):
        pass
    # Date only.
    try:
        return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC).isoformat()
    except ValueError:
        pass
    # Give up — keep the raw string so the agent can still see what was there.
    return value
