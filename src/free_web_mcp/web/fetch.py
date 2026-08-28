"""FetchService - download via WebClient (or RenderClient) and extract main text."""

from typing import TYPE_CHECKING

from free_web_mcp.config import Settings, get_settings
from free_web_mcp.models.page import FetchedPage
from free_web_mcp.web.client import PageContent, WebClient
from free_web_mcp.web.parser import extract_main_text, extract_title

if TYPE_CHECKING:
    from free_web_mcp.web.render import RenderClient


class FetchService:
    def __init__(
        self,
        client: WebClient,
        settings: Settings | None = None,
        render: "RenderClient | None" = None,
    ) -> None:
        self.client = client
        self.settings = settings or get_settings()
        self.render = render

    async def fetch(self, url: str, *, rendered: bool = False) -> FetchedPage:
        if rendered:
            page = await self._fetch_rendered(url)
        else:
            page = await self.client.get(url)
        html = page.content.decode("utf-8", errors="replace")
        title = extract_title(html)
        content = extract_main_text(html)
        return FetchedPage(url=page.url, title=title, content=content, text_length=len(content))

    async def _fetch_rendered(self, url: str) -> PageContent:
        if not self.settings.render_enabled:
            from free_web_mcp.errors import ErrorCode, ToolError

            raise ToolError(
                ErrorCode.RENDER_FAILED,
                "Rendered fetch is disabled. Set RENDER_ENABLED=true to use it.",
            )
        if self.render is None:
            from free_web_mcp.web.render import RenderClient

            self.render = RenderClient(self.settings)
        return await self.render.get(url)
