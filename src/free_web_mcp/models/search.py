"""Search data models."""

from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str = ""
    source: str


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult] = Field(default_factory=list)
