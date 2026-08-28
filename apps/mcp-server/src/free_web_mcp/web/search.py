"""SearchService - multi-provider orchestration (spec: search aggregation).

Provider chain (settings.search_provider):
  auto        -> DuckDuckGo, then Bing, then Baidu (merge + dedupe until full)
  duckduckgo  -> DuckDuckGo only
  bing        -> Bing HTML only
  baidu       -> Baidu HTML only

Results are deduped by URL across providers; confidence/domain enrichment
runs once on the merged list.
"""

from datetime import UTC, datetime
from urllib.parse import urlparse

from free_web_mcp.config import Settings, get_settings
from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.logging import get_logger
from free_web_mcp.models.search import SearchResponse, SearchResult
from free_web_mcp.web.client import WebClient
from free_web_mcp.web.providers import BaiduProvider, BingProvider, DuckDuckGoProvider

logger = get_logger(__name__)

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
        provider: object | None = None,
        settings: Settings | None = None,
        client: WebClient | None = None,
        providers: list[object] | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.client = client
        self._explicit_provider = provider
        self._explicit_providers = providers
        self.chain = providers if providers is not None else self._build_chain()

    @property
    def provider(self) -> object | None:
        return self._explicit_provider

    @provider.setter
    def provider(self, p: object | None) -> None:
        # Back-compat: tests assign `service.provider = fake` post-construction.
        self._explicit_provider = p
        self.chain = [p] if p is not None else self._build_chain()

    def _build_chain(self) -> list[object]:
        """Ordered provider list. An explicit provider (tests / DI) wins."""
        if self._explicit_provider is not None:
            return [self._explicit_provider]
        mode = (self.settings.search_provider or "auto").lower()
        if mode == "duckduckgo":
            return [DuckDuckGoProvider()]
        if mode == "bing":
            return [BingProvider(self._client_for_html_providers())]
        if mode == "baidu":
            return [BaiduProvider(self._client_for_html_providers())]
        # auto: DDG primary, HTML providers as fallbacks
        return [
            DuckDuckGoProvider(),
            BingProvider(self._client_for_html_providers()),
            BaiduProvider(self._client_for_html_providers()),
        ]

    def _client_for_html_providers(self) -> WebClient:
        if self.client is None:
            self.client = WebClient(self.settings)
        return self.client

    def _clamp(self, max_results: int) -> int:
        return max(1, min(max_results, self.settings.search_max_results))

    async def search(self, query: str, max_results: int | None = None) -> SearchResponse:
        limit = self._clamp(max_results or 5)

        merged: list[SearchResult] = []
        seen_urls: set[str] = set()
        errors: list[str] = []

        for provider in self.chain:
            if len(merged) >= limit:
                break
            try:
                results: list[SearchResult] = await provider.search(query, limit)  # type: ignore[attr-defined]
            except ToolError as exc:
                logger.warning("provider %s failed: %s", getattr(provider, "name", provider), exc)
                errors.append(str(exc))
                continue
            except Exception as exc:  # never let a raw provider exception escape
                logger.warning("provider %s crashed: %s", getattr(provider, "name", provider), exc)
                errors.append(str(exc))
                continue

            for r in results:
                if not r.url or r.url in seen_urls:
                    continue
                seen_urls.add(r.url)
                merged.append(r)
                if len(merged) >= limit:
                    break

        if not merged:
            if errors:
                raise ToolError(
                    ErrorCode.SEARCH_FAILED,
                    "All search providers failed: " + "; ".join(errors[:3]),
                )
            return SearchResponse(query=query, results=[])

        for rank, result in enumerate(merged):
            result.source_domain = _extract_source_domain(result.url)
            result.confidence = _compute_confidence(rank, len(merged), result.source_domain)
        return SearchResponse(query=query, results=merged)


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
