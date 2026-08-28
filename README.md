# free_web_mcp

Free Web MCP —— 一个免费的 MCP Server，为 Claude / Cursor / 其他 MCP Client 提供网络搜索（DuckDuckGo，无需 API Key）与网页抓取 + 正文提取工具。

详细需求见 [docs/free_web_mcp.md](docs/free_web_mcp.md)。

## Tools

| Tool | 说明 |
| --- | --- |
| `web_search(query, max_results=5)` | DuckDuckGo 搜索，返回 `{title,url,snippet,source,source_domain,confidence}` |
| `web_fetch(url, rendered=False)` | 抓取网页并提取正文，返回 `{url,title,content,text_length,meta}`；`rendered=True` 时驱动 headless Chromium（需 `RENDER_ENABLED=true`） |
| `web_search_and_fetch(query, max_results=5, rendered=False)` | 搜索后逐个抓取 Top N 结果正文 |
| `web_summarize_with_sources(url=None, html=None, max_links=25)` | 抽取作者 / 引用 / 链接；按 **一手 / 二手 / 三手** 分类，让 AI 自主判断可信度 |

## 快速开始

```bash
uv sync
```

### stdio 模式（本地客户端）

```bash
uv run free-web-mcp                # 或: uv run python -m free_web_mcp
```

Cursor / Claude Desktop 配置示例：

```json
{
  "mcpServers": {
    "free-web-mcp": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/free_web_mcp", "free-web-mcp"]
    }
  }
}
```

### HTTP 模式（远程部署）

```bash
uv run free-web-mcp --transport http   # 监听 .env 中的 HOST/PORT，默认 0.0.0.0:8000
curl http://localhost:8000/health      # -> {"status":"ok","service":"free-web-mcp"}
```

MCP streamable-http 端点：`http://<host>:8000/mcp`。

### 公开 Live URL（给评委 / 远程用户）

两种方式，详见 [`docs/deploy_live_url.md`](docs/deploy_live_url.md)：

- **Render（永久）**：`render.yaml` 已配好，导入 Render Blueprint 即可
- **ngrok（即时）**：`ngrok http 8000` 立刻出一个 `https://*.ngrok-free.app`

测活：`uv run python scripts/e2e_http_check.py https://<your-url>`

---

### Docker

```bash
# 默认：仅 HTTP 抓取路径
docker build -f docker/Dockerfile -t free-web-mcp .
docker run --rm -p 8000:8000 free-web-mcp

# 启用 headless 渲染（构建时下载 Chromium ~150MB；首次启动约 1-3s）
docker build -f docker/Dockerfile --build-arg INSTALL_PLAYWRIGHT_BROWSERS=true -t free-web-mcp:render .
docker run --rm -p 8000:8000 -e RENDER_ENABLED=true free-web-mcp:render
```

## 配置（.env）

复制 `.env.example` 为 `.env` 后按需修改；`.env` 不入库。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| HOST / PORT | 0.0.0.0 / 8000 | HTTP 监听地址 |
| LOG_LEVEL | INFO | 日志级别 |
| HTTP_TIMEOUT | 30 | 抓取超时（秒） |
| MAX_CONTENT_LENGTH | 5000000 | 响应体大小上限（字节） |
| SEARCH_MAX_RESULTS | 10 | max_results 的硬上限 |
| RENDER_ENABLED | false | 是否启用 headless 浏览器（Playwright + Chromium） |
| RENDER_TIMEOUT | 30 | 渲染超时（秒） |
| RENDER_MAX_BYTES | 5000000 | 渲染后响应体大小上限 |

## 开发

```bash
uv run pytest                  # 测试
uv run ruff check .            # lint
uv run mypy                    # 类型检查（strict）
```

## 架构

严格分层：MCP Tool 层 → Service 层（SearchService/FetchService）→ Provider/HTTP 层。搜索源可插拔（当前实现：`DuckDuckGoProvider`），HTTP 统一走 `WebClient`，正文提取 trafilatura 优先、BeautifulSoup 兜底。详见 AGENTS.md。
