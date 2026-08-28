"""SearchService - orchestration of the pluggable provider."""

from datetime import UTC, datetime
from urllib.parse import urlparse

from free_web_mcp.config import Settings, get_settings
from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.models.search import SearchResponse, SearchResult
from free_web_mcp.web.providers import DuckDuckGoProvider

# Simple authority signals — small allow-list, deliberately conservative.
_AUTHORITATIVE_TLDS = (".gov", ".edu", ".int", ".ac.", ".mil")
_AUTHORITATIVE_DOMAIN_HINTS = (
    "wikipedia.org",
    "nature.com",
    "sciencedirect",
    "pubmed",
    "arxiv.org",
    "britannica",
    "reuters.com",
    "apnews.com",
    "bbc.",
)


class SearchService:
    def __init__(
        self,
        provider: DuckDuckGoProvider | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.provider = provider or DuckDuckGoProvider()
        self.settings = settings or get_settings()

    def _clamp(self, max_results: int) -> int:
        return max(1, min(max_results, self.settings.search_max_results))

    async def search(self, query: str, max_results: int | None = None) -> SearchResponse:
        limit = self._clamp(max_results or 5)
        try:
            results: list[SearchResult] = await self.provider.search(query, limit)
        except ToolError:
            raise
        except Exception as exc:  # never let a raw provider exception escape
            raise ToolError(ErrorCode.SEARCH_FAILED, "Web search failed.") from exc

        for rank, result in enumerate(results):
            result.source_domain = _extract_source_domain(result.url)
            result.confidence = _compute_confidence(rank, len(results), result.source_domain)
        return SearchResponse(query=query, results=results)


def _extract_source_domain(url: str) -> str:
    if not url:
        return ""
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _compute_confidence(rank: int, total: int, domain: str) -> float:
    if not domain:
        return 0.0
    # Rank contributes 0.0 (last) to 0.5 (first); top result gets the full boost.
    rank_score = 0.5 * (1 - rank / max(total, 1)) if total > 1 else 0.5
    base = 0.5 + rank_score
    if any(domain.endswith(tld) for tld in _AUTHORITATIVE_TLDS):
        base += 0.2
    elif any(hint in domain for hint in _AUTHORITATIVE_DOMAIN_HINTS):
        base += 0.15
    return round(max(0.0, min(1.0, base)), 3)


# Stamped into PageMeta.fetched_at — kept here so the timezone rule is in one place.
def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()
