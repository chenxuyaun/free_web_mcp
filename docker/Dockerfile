FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# System packages needed by Chromium (libs only; --with-deps pulls them in).
RUN apt-get update && apt-get install --no-install-recommends -y \
        ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 \
        libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
        libgbm1 libgcc-s1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
        libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
        libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
        libxss1 libxtst6 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY README.md LICENSE ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Chromium is downloaded only if RENDER_ENABLED is turned on at runtime.
# Running the install at build time makes cold start instant when rendering
# is used; the chromium download is ~150MB and is skipped if you don't need it.
ARG INSTALL_PLAYWRIGHT_BROWSERS=false
RUN if [ "$INSTALL_PLAYWRIGHT_BROWSERS" = "true" ]; then \
        uv run --no-sync playwright install chromium; \
    fi

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')"]

CMD ["uv", "run", "--no-sync", "free-web-mcp", "--transport", "http"]
