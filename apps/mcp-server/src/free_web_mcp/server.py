"""FastAPI application for the HTTP transport: /health plus mounted MCP."""

import secrets
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from mcp.server.transport_security import TransportSecuritySettings

from free_web_mcp import __version__
from free_web_mcp.deps import AppContext, get_context
from free_web_mcp.logging import get_logger
from free_web_mcp.mcp.server import create_mcp_server

logger = get_logger(__name__)


def _presented_key(request: Request) -> str:
    """The caller's key, from X-API-Key or a Bearer token."""
    direct = request.headers.get("x-api-key") or ""
    if direct:
        return direct.strip()
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def create_app(ctx: AppContext | None = None) -> FastAPI:
    ctx = ctx or get_context()
    mcp_server = create_mcp_server(ctx)
    # MCP SDK 2.x: transport_security moved from the MCPServer constructor to
    # streamable_http_app(). stateless_http stays off to keep the legacy
    # session protocol for existing clients — flip to True when the x402
    # payment gateway lands (2026-07-28 sessionless protocol).
    mcp_app = mcp_server.streamable_http_app(
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=False,
        ),
        stateless_http=False,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # The mounted MCP sub-app owns its own lifespan (session manager);
        # re-enter it here so it starts together with the outer application.
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(mcp_app.router.lifespan_context(mcp_app))
            try:
                yield
            finally:
                await ctx.aclose()

    app = FastAPI(title=ctx.settings.app_name, lifespan=lifespan)
    api_key = (ctx.settings.mcp_api_key or "").strip()

    @app.middleware("http")
    async def require_api_key(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Gate the MCP endpoint behind a shared key when one is configured.

        Measured exposure before this existed: the public URL accepted anonymous
        tools/call, so any scanner could use the server as a free search proxy and
        drive evidence/anchor writes. /health and the discovery doc stay open so
        monitoring keeps working; with no key configured nothing changes, which is
        only appropriate for a 127.0.0.1-bound dev instance.
        """
        if api_key and request.url.path.rstrip("/") == "/mcp":
            if not secrets.compare_digest(_presented_key(request), api_key):
                logger.warning("mcp: rejected unauthenticated call from %s", request.client)
                return JSONResponse(
                    {"error": "unauthorized", "detail": "missing or wrong X-API-Key"},
                    status_code=401,
                )
        return await call_next(request)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": ctx.settings.app_name, "version": __version__}

    @app.get("/.well-known/mcp.json")
    async def well_known() -> JSONResponse:
        """Lightweight discoverability document.

        The MCP 2025-06-18 spec does not mandate this file, but it is the
        de-facto convention for remote MCP servers and what top entries
        in the MCP ecosystem (Sentry, Cloudflare, Linear) publish.
        """
        tools = await mcp_server.list_tools()
        # mcp-types 2.x serializes annotations with snake_case fields
        # (read_only_hint); the MCP spec uses camelCase — map explicitly.
        return JSONResponse(
            {
                "name": ctx.settings.app_name,
                "version": __version__,
                "transport": "streamable-http",
                "endpoint": "/mcp",
                "health": "/health",
                "protocol_version": "2025-06-18",
                "tools": [
                    {
                        "name": t.name,
                        "title": t.title,
                        "description": t.description,
                        "inputSchema": t.input_schema,
                        "annotations": (
                            {
                                "readOnlyHint": t.annotations.read_only_hint,
                                "openWorldHint": t.annotations.open_world_hint,
                                "destructiveHint": t.annotations.destructive_hint,
                            }
                            if t.annotations is not None
                            else None
                        ),
                    }
                    for t in tools
                ],
            }
        )

    app.mount("/", mcp_app)
    return app
