"""Fetched-page data models."""

from pydantic import BaseModel, Field

from free_web_mcp.errors import ToolErrorPayload
from free_web_mcp.models.search import SearchResult


class PageMeta(BaseModel):
    """Provenance signals about the fetched page so an AI agent can
    judge "is this content fresh / authoritative / from a primary source"
    before it cites the result.
    """

    domain_type: str = "other"  # government | academic | news | docs | wiki | forum | blog | other
    https: bool
    published_at: str | None = None  # ISO-8601 if a date was detectable, else None
    fetched_at: str  # ISO-8601 stamped by the service layer
    content_length_raw: int  # byte length of the raw HTTP body
    author: str | None = None


class FetchedPage(BaseModel):
    url: str
    title: str
    content: str
    text_length: int
    meta: PageMeta


class SuccessResult(BaseModel):
    success: bool = True


class PageResult(SuccessResult):
    page: FetchedPage


class SearchPageItem(BaseModel):
    search: SearchResult
    fetched: FetchedPage | None = None
    error: ToolErrorPayload | None = None


class SearchAndFetchResponse(SuccessResult):
    query: str
    items: list[SearchPageItem] = []


class SourceLink(BaseModel):
    href: str
    text: str
    domain: str
    tier: str  # "primary" | "secondary" | "tertiary"


class SourceSummary(BaseModel):
    url: str
    authors: list[str] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)
    links: list[SourceLink] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
