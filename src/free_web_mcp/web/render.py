"""Optional JS-rendered fetch path via Playwright. Lazily imported so the
default `rendered=False` flow never depends on Playwright being importable.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING

from free_web_mcp.config import Settings
from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.logging import get_logger
from free_web_mcp.web.client import PageContent

if TYPE_CHECKING:
    from playwright.async_api import Browser, BrowserContext

logger = get_logger(__name__)


class RenderClient:
    """Playwright-backed fetcher producing a PageContent compatible
    with the existing parser stack."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._lock = asyncio.Lock()

    async def _ensure_started(self) -> None:
        if self._context is not None:
            return
        if not self._settings.render_enabled:
            raise ToolError(
                ErrorCode.RENDER_FAILED,
                "Rendered fetch is disabled. Set RENDER_ENABLED=true to use it.",
            )
        async with self._lock:
            if self._context is not None:
                return
            try:
                from playwright.async_api import async_playwright
            except Exception as exc:  # pragma: no cover - environment dependent
                raise ToolError(
                    ErrorCode.RENDER_FAILED,
                    "Playwright is not installed.",
                ) from exc
            try:
                pw = await async_playwright().start()
                self._browser = await pw.chromium.launch()
                self._context = await self._browser.new_context()
            except Exception as exc:
                logger.warning("playwright start failed: %s", exc)
                await self._hard_close()
                raise ToolError(
                    ErrorCode.RENDER_FAILED, "Failed to start headless browser."
                ) from exc

    async def get(self, url: str) -> PageContent:
        if not (url.startswith("http://") or url.startswith("https://")):
            raise ToolError(ErrorCode.INVALID_URL, "URL must start with http:// or https://.")
        await self._ensure_started()
        assert self._context is not None
        page = await self._context.new_page()
        try:
            from playwright.async_api import TimeoutError as PlaywrightTimeoutError

            await page.goto(
                url,
                timeout=self._settings.render_timeout * 1000,
                wait_until="domcontentloaded",
            )
            content = (await page.content()).encode("utf-8")
            if len(content) > self._settings.render_max_bytes:
                raise ToolError(
                    ErrorCode.CONTENT_TOO_LARGE,
                    "Rendered response exceeds the size limit.",
                )
            return PageContent(
                url=page.url,
                status_code=200,
                content=content,
                content_type="text/html",
            )
        except ToolError:
            raise
        except PlaywrightTimeoutError as exc:
            raise ToolError(
                ErrorCode.RENDER_TIMEOUT,
                f"Render timed out after {self._settings.render_timeout}s.",
            ) from exc
        except Exception as exc:
            logger.warning("render failed for %s: %s", url, exc)
            raise ToolError(
                ErrorCode.RENDER_FAILED, "Headless browser failed to render the page."
            ) from exc
        finally:
            await page.close()

    async def _hard_close(self) -> None:
        if self._context is not None:
            with contextlib.suppress(Exception):
                await self._context.close()
            self._context = None
        if self._browser is not None:
            with contextlib.suppress(Exception):
                await self._browser.close()
            self._browser = None

    async def aclose(self) -> None:
        await self._hard_close()
