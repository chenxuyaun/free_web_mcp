"""Web access layer - the only place that touches HTTP and HTML."""

from free_web_mcp.web.client import WebClient
from free_web_mcp.web.fetch import FetchService
from free_web_mcp.web.render import RenderClient
from free_web_mcp.web.search import SearchService

__all__ = ["FetchService", "RenderClient", "SearchService", "WebClient"]
