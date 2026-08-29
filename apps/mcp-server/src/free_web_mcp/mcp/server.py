"""MCP server factory - one MCPServer instance reused by both transports."""

from mcp.server.mcpserver import MCPServer

from free_web_mcp import __version__
from free_web_mcp.deps import AppContext, get_context
from free_web_mcp.mcp.tools import register_tools

INSTRUCTIONS = (
    "free-web-mcp provides free web search and fetch tools backed by DuckDuckGo. "
    "Prefer web_search_and_fetch when you need both a query and the text of the "
    "top results. For each web_fetch result, read meta.domain_type and "
    "meta.published_at to gauge authority and freshness. web_summarize_with_sources "
    "classifies each link as primary (same domain), secondary (gov/edu/academic), or "
    "tertiary (aggregator/social) - use the tier field to weight citations."
)


def create_mcp_server(ctx: AppContext | None = None) -> MCPServer:
    # MCP SDK 2.x (2026-07-28 protocol era): `version` is a first-class kwarg,
    # so serverInfo.version now reports the app version. transport_security
    # moved to streamable_http_app() (see free_web_mcp/server.py).
    server = MCPServer(
        name="free-web-mcp",
        version=__version__,
        instructions=f"{INSTRUCTIONS} (app version {__version__})",
    )
    register_tools(server, ctx or get_context())
    return server


_mcp_singleton: MCPServer | None = None


def get_mcp() -> MCPServer:
    """Process-wide singleton used by `__main__`."""
    global _mcp_singleton
    if _mcp_singleton is None:
        _mcp_singleton = create_mcp_server()
    return _mcp_singleton
