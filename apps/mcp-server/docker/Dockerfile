FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Minimal MCP server image (no Chromium/Playwright libs — rendering is
# disabled in this deployment and the apt packages above were bookworm-
# incompatible anyway).

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

EXPOSE 8766

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8766/health')"]

CMD ["uv", "run", "--no-sync", "free-web-mcp", "--transport", "http", "--host", "0.0.0.0", "--port", "8766"]
