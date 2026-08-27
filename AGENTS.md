# AGENTS.md

## 项目状态与必读文档

本仓库目前处于**起步阶段**：只有 README 和需求文档，尚无代码。开始任何实现前，先通读
`docs/free_web_mcp.md` —— 它是本项目唯一的需求/设计来源，定义了第一版（MVP）的全部范围。

## 项目目的

**Free Web MCP**：一个可供 Claude / Cursor / 其他 MCP Client 调用的 MCP Server，提供免费的网络搜索与网页抓取能力。最终链路：

```
MCP Client → Free Web MCP Server → Web Search / Web Fetch → Internet
```

## 第一版 MVP 范围

只做 5 件事的闭环：**MCP Server + Web Search + Web Fetch + Content Extraction + Docker**。

首批 3 个 MCP tools：
- `web_search(query, max_results=5)` → `{results:[{title,url,snippet,source}]}`
- `web_fetch(url)` → `{url,title,content,text_length}`
- `web_search_and_fetch(query, max_results=5)` → 搜索后抓取 Top N URL 并提取正文

必须提供 `GET /health` 返回 `{"status":"ok","service":"free-web-mcp"}`。

**明确不做**（第一阶段禁止引入）：用户系统、数据库、前端 Dashboard、任务队列、Redis、K8s、多搜索引擎聚合、AI 总结模型。第二阶段才做 Search Aggregation / Cache / Retry / Rate Limit / Proxy / Browser Rendering 等。

## 技术栈（不要偏离）

Python 3.12+，包管理用 **uv**；依赖：`mcp`（官方 SDK）、`fastapi`、`uvicorn`、`httpx`、`beautifulsoup4`、`trafilatura`、`python-dotenv`、`pydantic`、`pydantic-settings`。开发依赖：`pytest`、`pytest-asyncio`、`ruff`、`mypy`。

## 目录结构约定

源码放 `src/free_web_mcp/`，测试放 `tests/`（test_search / test_fetch / test_parser / test_mcp）。规划中的模块：

```
src/free_web_mcp/
├── server.py / config.py / logging.py
├── mcp/      # server.py, tools.py  —— MCP 工具层
├── web/      # client.py, search.py, fetch.py, parser.py —— 服务层
└── models/   # search.py, page.py
```

## 架构边界规则（最重要）

严格分层：MCP Tool Layer → Service Layer（SearchService/FetchService）→ Provider Layer（SearchProvider/WebClient/Parser）。MCP 工具层**绝不直接**发 HTTP 请求或解析 HTML——所有 HTTP 走统一的 `WebClient`（统一 timeout/User-Agent/retry/编码），所有搜索走可插拔 `SearchProvider` 抽象（未来 DuckDuckGo/Bing/Brave 等实现）。换搜索引擎时只改 Provider，MCP 层不动。

内容提取策略：优先 **trafilatura** 提取正文，BeautifulSoup 仅作 fallback；不要用简单的 `get_text()`（会混入导航/广告/footer）。

## 编码与运行约定

- 配置经 `.env` + pydantic-settings，提供 `.env.example`；`.env` 绝不入库。
- 错误不直接抛给 MCP Client：返回 `{success:false,error:{type,message}}`，错误类型统一为 INVALID_URL / FETCH_FAILED / TIMEOUT / HTTP_ERROR / PARSER_ERROR / SEARCH_FAILED / RATE_LIMITED / CONTENT_TOO_LARGE。
- 日志用 Python logging 记录请求与结果数量，但**不得记录** API Key、Cookie、Authorization 或用户敏感数据。
- 提交信息使用 Conventional Commits（feat:/fix:/docs:/refactor:/test:/chore:/perf:）。

## 常用命令

```bash
uv sync                                        # 安装依赖
uv run python -m free_web_mcp                  # 启动 server
uv run uvicorn free_web_mcp.server:app --host 0.0.0.0 --port 8000
uv run pytest                                  # 测试
uv run ruff check . && uv run mypy src         # lint + 类型检查
docker build -t free-web-mcp .                 # Docker（基础镜像 python:3.12-slim）
```

## 开发顺序（来自需求文档 §23）

Python/uv → Git → MCP SDK 最小 Server → web_search → web_fetch → 内容提取 → /health → pytest → Docker → 真实 MCP Client 连接验证 → 才进入 Provider 抽象与扩展功能。

## 平台注意

开发环境是 **Windows**（Git Bash），激活虚拟环境用 `.venv\Scripts\activate` 或在 bash 中 `source .venv/Scripts/activate`；项目同时面向 Linux Docker/systemd 部署，路径与脚本要跨平台兼容。
