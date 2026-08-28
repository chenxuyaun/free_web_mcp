"""MCP server factory - one FastMCP instance reused by both transports."""

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

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


def create_mcp_server(ctx: AppContext | None = None) -> FastMCP:
    # Disable DNS-rebinding host validation by default so the server works
    # behind ngrok, Render, or any reverse proxy without per-deploy allowlists.
    # The HTTP transport still requires a proper Origin header on POSTs from
    # browsers (browsers always send one), which is what the spec recommends.
    #
    # Note: the MCP 1.x FastMCP API does not accept a server `version=` kwarg.
    # The `serverInfo.version` reported to clients is therefore the mcp SDK
    # version. The application version is surfaced through `instructions` and
    # through the `/.well-known/mcp.json` and `/health` endpoints.
    server = FastMCP(
        name="free-web-mcp",
        instructions=f"{INSTRUCTIONS} (app version {__version__})",
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=False,
        ),
    )
    register_tools(server, ctx or get_context())
    return server


_mcp_singleton: FastMCP | None = None


def get_mcp() -> FastMCP:
    """Process-wide singleton used by `__main__`."""
    global _mcp_singleton
    if _mcp_singleton is None:
        _mcp_singleton = create_mcp_server()
    return _mcp_singleton
