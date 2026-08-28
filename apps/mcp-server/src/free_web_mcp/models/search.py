"""Search data models."""

from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str = ""
    source: str
    source_domain: str = ""
    confidence: float = 0.0  # 0.0-1.0, simple heuristic; consumers must not treat as ground truth


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult] = Field(default_factory=list)
