"""Fetched-page data models."""

from pydantic import BaseModel

from free_web_mcp.errors import ToolErrorPayload
from free_web_mcp.models.search import SearchResult


class FetchedPage(BaseModel):
    url: str
    title: str
    content: str
    text_length: int


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
