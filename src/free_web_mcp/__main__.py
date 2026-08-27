"""CLI entry point: `python -m free_web_mcp` or the `free-web-mcp` script."""

import argparse

from free_web_mcp import __version__
from free_web_mcp.config import get_settings
from free_web_mcp.logging import setup_logging


def main(argv: list[str] | None = None) -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(prog="free-web-mcp", description=__doc__)
    parser.add_argument(
        "--transport",
        choices=("stdio", "http"),
        default="stdio",
        help="MCP transport: stdio (default) or http (FastAPI on HOST:PORT).",
    )
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    args = parser.parse_args(argv)

    setup_logging()
    if args.transport == "http":
        import uvicorn

        from free_web_mcp.server import create_app

        uvicorn.run(create_app(), host=args.host, port=args.port)
    else:
        from free_web_mcp.mcp.server import get_mcp

        get_mcp().run(transport="stdio")


if __name__ == "__main__":
    main()
