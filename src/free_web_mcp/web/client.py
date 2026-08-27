import httpx
from pydantic import AnyUrl

from free_web_mcp.config import get_settings
from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.logging import get_logger

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

logger = get_logger(__name__)


class PageContent:
    """Raw response of a successful GET."""

    def __init__(self, url: str, status_code: int, content: bytes, content_type: str) -> None:
        self.url = url
        self.status_code = status_code
        self.content = content
        self.content_type = content_type


class WebClient:
    """Single HTTP entry point for the whole project.

    Centralizes timeouts, User-Agent, redirects, status checks and the
    response-size cap so tools never issue raw HTTP themselves.
    """

    def __init__(self, settings: object | None = None) -> None:
        s = settings or get_settings()
        self._timeout = float(getattr(s, "http_timeout", 30))
        self._max_bytes = int(getattr(s, "max_content_length", 5_000_000))
        self._client = httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
            limits=httpx.Limits(max_connections=20),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _validate_url(url: str) -> None:
        try:
            parsed = AnyUrl(url)
        except Exception as exc:
            raise ToolError(ErrorCode.INVALID_URL, "Invalid URL.") from exc
        # pydantic keeps scheme on AnyUrl even for relative-ish input
        if parsed.scheme not in ("http", "https"):
            raise ToolError(ErrorCode.INVALID_URL, "URL must start with http:// or https://.")

    async def get(self, url: str) -> PageContent:
        """GET a page, mapping network failures to stable ToolError codes."""
        self._validate_url(url)
        logger.info("web_fetch url=%s", url)
        try:
            response = await self._client.get(url)
        except httpx.TimeoutException as exc:
            raise ToolError(
                ErrorCode.TIMEOUT, f"Request timed out after {self._timeout}s."
            ) from exc
        except httpx.HTTPError as exc:
            raise ToolError(ErrorCode.FETCH_FAILED, "Unable to retrieve the webpage.") from exc

        if response.status_code >= 400:
            raise ToolError(
                ErrorCode.HTTP_ERROR,
                f"Upstream returned HTTP {response.status_code}.",
            )
        declared_size = len(response.content)
        if declared_size > self._max_bytes:
            raise ToolError(ErrorCode.CONTENT_TOO_LARGE, "Response exceeds the size limit.")

        return PageContent(
            url=str(response.url),
            status_code=response.status_code,
            content=response.content,
            content_type=response.headers.get("content-type", ""),
        )
