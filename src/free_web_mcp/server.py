"""FastAPI application for the HTTP transport: /health plus mounted MCP."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI

from free_web_mcp.deps import AppContext, get_context
from free_web_mcp.mcp.server import create_mcp_server


def create_app(ctx: AppContext | None = None) -> FastAPI:
    ctx = ctx or get_context()
    mcp_server = create_mcp_server(ctx)
    mcp_app = mcp_server.streamable_http_app()

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

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": ctx.settings.app_name}

    app.mount("/", mcp_app)
    return app
