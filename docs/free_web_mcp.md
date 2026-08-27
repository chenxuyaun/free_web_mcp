
如果你现在准备正式做 **Free Web MCP**，我建议不要一开始就堆功能，而是先把**基础工程环境 + MCP Server + Web Search + Web Fetch**跑通。

下面给你一套可以直接开工的完整基础方案。

# Free Web MCP 基础环境搭建方案

## 1. 第一阶段目标

先做到这一条链路完整跑通：

```text
Claude / ChatGPT / Cursor / 其他 MCP Client
                │
                │ MCP
                ▼
        ┌─────────────────┐
        │  Free Web MCP   │
        │    Server       │
        └────────┬────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
   Web Search         Web Fetch
        │                 │
        └────────┬────────┘
                 ▼
              Internet
```

第一阶段**不要做**：

* 用户系统
* 数据库
* 前端 Dashboard
* 复杂任务队列
* Redis
* Kubernetes
* Docker 集群
* 多搜索引擎聚合
* AI 总结模型

先把 MCP Server 做成一个**稳定、能被 MCP Client 调用的服务**。

---

# 2. 推荐技术栈

我建议：

| 部分            | 技术                  |
| ------------- | ------------------- |
| 编程语言          | Python 3.12+        |
| MCP           | MCP Python SDK      |
| Web Framework | FastAPI             |
| HTTP          | httpx               |
| HTML 解析       | BeautifulSoup4      |
| 内容提取          | trafilatura         |
| 搜索            | 可插拔 Search Provider |
| 配置            | `.env`              |
| 日志            | Python logging      |
| 测试            | pytest              |
| 类型检查          | mypy                |
| 代码规范          | Ruff                |
| 包管理           | uv                  |
| 容器            | Docker              |
| 部署            | Docker / systemd    |
| CI            | GitHub Actions      |
| License       | MIT                 |

其中最重要的是：

> **Python + MCP SDK + FastAPI + httpx + BeautifulSoup/trafilatura**

---

# 3. 开发环境

如果你是 Linux 服务器：

```bash
sudo apt update

sudo apt install -y \
    git \
    curl \
    wget \
    build-essential \
    python3 \
    python3-pip \
    python3-venv
```

检查：

```bash
python3 --version
git --version
```

推荐 Python：

```text
Python >= 3.12
```

---

# 4. 推荐安装 uv

项目使用 `uv` 管理 Python 环境。

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

重新加载：

```bash
source ~/.bashrc
```

检查：

```bash
uv --version
```

然后：

```bash
uv python install 3.12
```

---

# 5. 创建项目

```bash
mkdir free-web-mcp
cd free-web-mcp
```

初始化：

```bash
uv init
```

创建虚拟环境：

```bash
uv venv
```

激活：

```bash
source .venv/bin/activate
```

Windows：

```powershell
.venv\Scripts\activate
```

---

# 6. 安装核心依赖

```bash
uv add \
    mcp \
    fastapi \
    uvicorn \
    httpx \
    beautifulsoup4 \
    trafilatura \
    python-dotenv \
    pydantic \
    pydantic-settings
```

开发依赖：

```bash
uv add --dev \
    pytest \
    pytest-asyncio \
    ruff \
    mypy
```

最终核心依赖大概是：

```text
mcp
fastapi
uvicorn
httpx
beautifulsoup4
trafilatura
python-dotenv
pydantic
pydantic-settings
```

---

# 7. 项目目录

不要把所有代码塞进 `server.py`。

建议直接按照可扩展架构：

```text
free-web-mcp/
│
├── pyproject.toml
├── uv.lock
├── README.md
├── LICENSE
├── .gitignore
├── .env.example
│
├── src/
│   └── free_web_mcp/
│       │
│       ├── __init__.py
│       ├── server.py
│       ├── config.py
│       ├── logging.py
│       │
│       ├── mcp/
│       │   ├── __init__.py
│       │   ├── server.py
│       │   └── tools.py
│       │
│       ├── web/
│       │   ├── __init__.py
│       │   ├── client.py
│       │   ├── search.py
│       │   ├── fetch.py
│       │   └── parser.py
│       │
│       ├── models/
│       │   ├── __init__.py
│       │   ├── search.py
│       │   └── page.py
│       │
│       └── utils/
│           ├── __init__.py
│           └── text.py
│
├── tests/
│   ├── test_search.py
│   ├── test_fetch.py
│   ├── test_parser.py
│   └── test_mcp.py
│
├── scripts/
│   └── dev.sh
│
└── docker/
    └── Dockerfile
```

这样以后增加：

```text
news_search
image_search
youtube_search
github_search
reddit_search
```

不会把项目搞成一锅粥。

---

# 8. 第一批 MCP Tools

第一版只做 3 个工具。

## `web_search`

负责搜索。

```text
web_search(
    query: str,
    max_results: int = 5
)
```

例如：

```text
web_search(
    query="latest AI agent frameworks",
    max_results=5
)
```

返回：

```json
{
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "source": "..."
    }
  ]
}
```

---

## `web_fetch`

负责读取网页。

```text
web_fetch(
    url: str
)
```

返回：

```json
{
  "url": "...",
  "title": "...",
  "content": "...",
  "text_length": 12345
}
```

---

## `web_search_and_fetch`

这是后面非常重要的高级工具。

```text
web_search_and_fetch(
    query: str,
    max_results: int = 5
)
```

执行：

```text
Query
  ↓
Search
  ↓
Top N URLs
  ↓
Fetch
  ↓
Extract text
  ↓
Clean
  ↓
Return
```

这样 AI 不需要自己：

```text
Search → 找 URL → 再 Fetch → 再解析
```

---

# 9. Web 层一定要独立

这是整个项目最重要的架构之一。

不要：

```text
MCP Tool
   ↓
直接 requests
   ↓
直接解析 HTML
```

而是：

```text
MCP
 │
 ▼
Tool Layer
 │
 ▼
Service Layer
 │
 ├── SearchService
 │
 └── FetchService
 │
 ▼
Provider Layer
 │
 ├── SearchProvider
 │
 ├── HTTPClient
 │
 └── Parser
```

以后搜索源变了，只修改 Provider。

例如：

```text
SearchProvider
      │
      ├── DuckDuckGoProvider
      ├── BingProvider
      ├── BraveProvider
      ├── GoogleProvider
      └── CustomProvider
```

MCP 层完全不用动。

---

# 10. HTTP Client

建议统一封装 HTTP 请求。

例如：

```python
class WebClient:
    async def get(self, url: str):
        ...
```

统一处理：

* timeout
* User-Agent
* redirects
* status code
* retry
* connection pool
* headers
* encoding
* robots / policy checks

例如默认：

```text
connect timeout: 10s
read timeout: 30s
total timeout: 40s
```

不要让每个工具自己写一套 HTTP 请求。

---

# 11. 网页解析

不要简单：

```python
BeautifulSoup(html).get_text()
```

这样会得到大量垃圾：

```text
Navigation
Login
Advertisement
Footer
Related Articles
...
```

优先：

```text
HTML
 ↓
trafilatura
 ↓
main article
 ↓
clean text
```

然后再使用 BeautifulSoup 作为 fallback。

目标：

```text
网页
 ↓
去掉 script
去掉 style
去掉 nav
去掉 footer
去掉广告
 ↓
正文
 ↓
Markdown / Plain Text
```

---

# 12. 配置文件

建立：

```text
.env.example
```

例如：

```env
APP_NAME=free-web-mcp
APP_ENV=development

HOST=0.0.0.0
PORT=8000

LOG_LEVEL=INFO

HTTP_TIMEOUT=30
MAX_CONTENT_LENGTH=5000000

SEARCH_MAX_RESULTS=10
```

真实：

```text
.env
```

不要提交 Git。

`.gitignore`：

```gitignore
.env
.venv/
__pycache__/
.pytest_cache/
.ruff_cache/
.mypy_cache/
*.pyc
dist/
build/
```

---

# 13. MCP Server 第一版

你最终需要得到：

```text
Free Web MCP Server
        │
        ├── web_search
        ├── web_fetch
        └── web_search_and_fetch
```

启动：

```bash
uv run python -m free_web_mcp
```

或者：

```bash
uv run uvicorn free_web_mcp.server:app \
    --host 0.0.0.0 \
    --port 8000
```

---

# 14. FastAPI

FastAPI主要负责：

```text
HTTP
Health Check
MCP HTTP Transport
Middleware
错误处理
```

至少提供：

```text
GET /health
```

返回：

```json
{
  "status": "ok",
  "service": "free-web-mcp"
}
```

以后还可以：

```text
GET /version
GET /health
GET /metrics
```

---

# 15. Health Check 很重要

以后部署服务器的时候，你可以：

```bash
curl http://localhost:8000/health
```

看到：

```json
{
  "status": "ok"
}
```

说明 Server 活着。

这对于 Docker、systemd、监控系统都很重要。

---

# 16. 日志系统

第一版就把日志做好。

例如：

```text
2026-08-27 17:30:21 INFO MCP server started
2026-08-27 17:30:25 INFO web_search query="AI agents"
2026-08-27 17:30:26 INFO search returned=5
2026-08-27 17:30:28 INFO web_fetch url="..."
2026-08-27 17:30:29 INFO fetch status=200
```

但是不要记录：

```text
Authorization
API Key
Cookie
用户敏感数据
```

---

# 17. 错误处理

一定不要把异常直接暴露给 MCP Client。

例如：

```text
网站打不开
```

不要：

```text
ConnectionError: HTTPSConnectionPool...
```

而应该：

```json
{
  "success": false,
  "error": {
    "type": "FETCH_FAILED",
    "message": "Unable to retrieve the webpage."
  }
}
```

错误类型可以统一：

```text
INVALID_URL
FETCH_FAILED
TIMEOUT
HTTP_ERROR
PARSER_ERROR
SEARCH_FAILED
RATE_LIMITED
CONTENT_TOO_LARGE
```

---

# 18. 测试环境

至少：

```text
tests/
├── test_search.py
├── test_fetch.py
├── test_parser.py
└── test_mcp.py
```

测试：

### Search

```text
输入 query
↓
得到 results
↓
results >= 1
```

### Fetch

```text
输入 URL
↓
HTTP 200
↓
得到 title
↓
得到 content
```

### Parser

测试：

```text
HTML
↓
正文
```

并确保：

```text
script
style
nav
广告
```

不会进入正文。

---

# 19. Docker

基础镜像：

```text
python:3.12-slim
```

最终：

```text
Docker
   ↓
Free Web MCP
   ↓
Port 8000
```

启动：

```bash
docker build -t free-web-mcp .
```

运行：

```bash
docker run \
    --rm \
    -p 8000:8000 \
    free-web-mcp
```

检查：

```bash
curl http://localhost:8000/health
```

---

# 20. Git 初始化

```bash
git init
```

第一次提交：

```bash
git add .
git commit -m "feat: initialize free web mcp"
```

建议后续使用 Conventional Commits：

```text
feat:
fix:
docs:
refactor:
test:
chore:
perf:
```

例如：

```bash
git commit -m "feat: add web search tool"
```

---

# 21. 第一阶段完成标准

你不要以“代码写完了”为标准。

而应该以：

### ✅ 环境

```text
Python 3.12+
uv
Git
```

### ✅ 项目

```text
src/
tests/
Dockerfile
README
LICENSE
```

### ✅ MCP

```text
MCP Server
```

### ✅ Tools

```text
web_search
web_fetch
```

### ✅ Web

```text
HTTP Client
HTML Parser
Content Extractor
```

### ✅ API

```text
/health
```

### ✅ 测试

```text
pytest
```

### ✅ 部署

```text
Docker
```

全部通过。

---

# 22. 第二阶段再做真正的“Free Web”

基础环境稳定之后，再开始解决项目真正的核心：

```text
                 Free Web MCP
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
      Search Engine           Web Fetch
          │                       │
     ┌────┴────┐             ┌────┴────┐
     ▼         ▼             ▼         ▼
 Provider A Provider B     Static    Dynamic
                              │         │
                              └────┬────┘
                                   ▼
                              Content Parser
                                   │
                                   ▼
                              Clean Markdown
```

然后再增加：

```text
Search Aggregation
Caching
Retry
Rate Limiting
Proxy
Browser Rendering
Content Deduplication
Result Ranking
Markdown Extraction
Robots Policy
Observability
```

---

# 23. 最终产品架构

长期可以演进成：

```text
                    ┌─────────────────────┐
                    │    MCP Clients      │
                    │                     │
                    │ Claude / Cursor /   │
                    │ AI Agents / etc.    │
                    └──────────┬──────────┘
                               │
                              MCP
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Free Web MCP      │
                    │                     │
                    │    MCP Gateway      │
                    └──────────┬──────────┘
                               │
               ┌───────────────┼────────────────┐
               ▼               ▼                ▼
          Web Search       Web Fetch       Content Tools
               │               │                │
               ▼               ▼                ▼
          Search Layer      HTTP Layer      Parser Layer
               │               │                │
        ┌──────┼──────┐        │          ┌─────┴─────┐
        ▼      ▼      ▼        ▼          ▼           ▼
      Engine Engine Engine   Internet   HTML       Markdown
        │      │      │                   │
        └──────┴──────┴───────────────────┘
                       │
                       ▼
                  Clean Results
```

## 🚀 建议你现在的开发顺序

**不要一次性把整个项目做完，按照这个顺序：**

```text
① Python / uv
       ↓
② Git 项目
       ↓
③ MCP SDK
       ↓
④ 最小 MCP Server
       ↓
⑤ web_search
       ↓
⑥ web_fetch
       ↓
⑦ HTML 内容提取
       ↓
⑧ /health
       ↓
⑨ pytest
       ↓
⑩ Docker
       ↓
⑪ MCP Client 实际连接测试
       ↓
⑫ Search Provider 抽象
       ↓
⑬ 多搜索源
       ↓
⑭ Cache / Retry / Rate Limit
       ↓
⑮ Browser / JS 页面支持
       ↓
⑯ Production 部署
```

**第一版 MVP 的核心其实只有 5 件事：**

> **MCP Server + Web Search + Web Fetch + Content Extraction + Docker**

先把这五个做成一个真正能工作的闭环，再往上加功能，成功率最高。
