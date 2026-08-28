"""MCP server factory - one FastMCP instance reused by both transports."""

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from free_web_mcp.deps import AppContext, get_context
from free_web_mcp.mcp.tools import register_tools


def create_mcp_server(ctx: AppContext | None = None) -> FastMCP:
    # Disable DNS-rebinding host validation by default so the server works
    # behind ngrok, Render, or any reverse proxy without per-deploy allowlists.
    # The HTTP transport still requires a proper Origin header on POSTs from
    # browsers (browsers always send one), which is what the spec recommends.
    server = FastMCP(
        name="free-web-mcp",
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
