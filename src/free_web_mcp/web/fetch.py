"""FetchService - download via WebClient and extract main text via parser."""

from free_web_mcp.config import Settings, get_settings
from free_web_mcp.models.page import FetchedPage
from free_web_mcp.web.client import WebClient
from free_web_mcp.web.parser import extract_main_text, extract_title


class FetchService:
    def __init__(self, client: WebClient, settings: Settings | None = None) -> None:
        self.client = client
        self.settings = settings or get_settings()

    async def fetch(self, url: str) -> FetchedPage:
        page = await self.client.get(url)
        html = page.content.decode("utf-8", errors="replace")
        title = extract_title(html)
        content = extract_main_text(html)
        return FetchedPage(url=page.url, title=title, content=content, text_length=len(content))
