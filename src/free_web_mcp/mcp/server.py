"""MCP server factory - one FastMCP instance reused by both transports."""

from mcp.server.fastmcp import FastMCP

from free_web_mcp.deps import AppContext, get_context
from free_web_mcp.mcp.tools import register_tools


def create_mcp_server(ctx: AppContext | None = None) -> FastMCP:
    server = FastMCP(name="free-web-mcp")
    register_tools(server, ctx or get_context())
    return server


_mcp_singleton: FastMCP | None = None


def get_mcp() -> FastMCP:
    """Process-wide singleton used by `__main__`."""
    global _mcp_singleton
    if _mcp_singleton is None:
        _mcp_singleton = create_mcp_server()
    return _mcp_singleton
