# Free Web MCP 演示视频录制脚本

目标时长：3 分钟（±20s）。读者群：开发者 / AI 工程师 / MCP 生态用户。
整体风格：终端 + IDE 切换，黑底浅字，BGM 轻柔电子。

---

## 0. 录前准备

- 终端：Windows Terminal / Git Bash，分屏：左边 IDE 嵌 Claude Desktop 或 Cursor 的 MCP 输入框，右边起 server 的终端
- 字体：JetBrains Mono / Cascadia Code，16-18pt
- 分辨率：1920×1080，30fps
- 提前把 README 顶部的 "Free Web MCP —— 一个免费的 MCP Server…" 这一屏存成 `assets/cover.png` 作片头
- 把 `examples/example.duckduckgo.json`（演示搜索的返回结果）准备好作静态截图插画
- 录屏工具：Windows 自带 `Xbox Game Bar` 即可（Win + G），或 OBS / ScreenToGif

## 1. 片头（0:00–0:15）

> 「Free Web MCP —— 一个为 Claude / Cursor / 其他 MCP Client 提供的免费网络搜索与网页抓取服务。今天我们演示它的三个工具和一条 JS 渲染增强路径。」

- 画面：标题卡片 + 仓库地址 `github.com/chenxuyaun/free_web_mcp` 居中显示
- 转场：淡入到桌面

## 2. 启动服务（0:15–0:30）

> 「一行 uv 启动，stdio 模式直接接入 MCP 客户端。」

终端演示（建议提前把 `uv sync` 跑好，避免录到下载）：

```bash
$ uv run free-web-mcp
```

服务起在 stdio，终端不打印调试噪声（开发时把 `LOG_LEVEL=INFO` 调高一些便于观众理解）。

- 镜头：终端光标闪烁 2 秒，证明是真实启动
- 切到 Cursor Settings → MCP，看到 "free-web-mcp" server 已 enabled

## 3. 工具一：web_search（0:30–1:00）

> 「第一个工具 web_search，无需 API Key，直接打 DuckDuckGo。」

在 Claude Desktop / Cursor 聊天框里发：

```
请用 web_search 查 "model context protocol"，max_results=3，把结果用列表形式整理给我。
```

- 镜头：聚焦对话窗口
- 工具返回后，让 AI 简单总结三条结果的标题 + 来源域名
- 切到终端的 server log：观众能看到 `web_search query=...` 和 `search returned=N`

## 4. 工具二：web_fetch（1:00–1:30）

> 「拿到 URL 之后，web_fetch 抓回正文——trafilatura 优先，BS4 兜底，script / nav / footer 不会进来。」

复制搜索结果第一条的 URL 交给 AI：

```
请用 web_fetch 抓 https://en.wikipedia.org/wiki/Model_Context_Protocol，告诉我文章前 200 字。
```

- 镜头：对话窗口中正文流回
- 高亮返回 JSON 的 `text_length` 字段，让观众感受"1 万字符的干净文本"
- 切到 README 工具表，对比 schema 与返回

## 5. 工具三：web_search_and_fetch（1:30–1:55）

> 「第三个工具是组合拳：一次搜索 + 抓取 Top N，正文带回来，省去 AI 自己串两步。」

```
请用 web_search_and_fetch 查 "trafilatura python" 拿到前 2 个结果的正文。
```

- 镜头：返回 `items[].search` + `items[].fetched` 嵌套结构
- 强调：每个 item 单独的成功/失败包装，AI 拿到的是可直接消费的 Markdown 原料

## 6. 高阶：JS 渲染路径（1:55–2:35）

> 「如果客户给了个 SPA，静态 HTML 抓回来是空壳。打开 RENDER_ENABLED，Playwright + Chromium 来帮忙。」

演示方案 A（推荐：用 example.com 这种不带 bot 检测的 SPA demo）：

```
请用 web_fetch 抓 https://example-spa.demo/ ，rendered=true，告诉我页面正文。
```

切到 `.env`，把 `RENDER_ENABLED=false` 改成 `true`：

```bash
$ echo "RENDER_ENABLED=true" >> .env
$ uv run free-web-mcp
```

- 第一次冷启动故意多停留 2-3 秒，配合旁白「首次启动会下载并启动 Chromium，所以稍等」
- AI 拿到渲染后正文
- 切到 `docker/Dockerfile` 一行 `playwright install chromium`，告诉观众"生产环境一次构建免下载"

## 7. 部署到 Docker（2:35–2:55）

> 「最后一条线：HTTP 模式 + Docker。」

```bash
$ docker build -f docker/Dockerfile \
    --build-arg INSTALL_PLAYWRIGHT_BROWSERS=true \
    -t free-web-mcp:render .
$ docker run --rm -p 8000:8000 -e RENDER_ENABLED=true free-web-mcp:render
$ curl http://localhost:8000/health
```

输出：

```json
{"status":"ok","service":"free-web-mcp"}
```

## 8. 收尾（2:55–3:05）

- 仓库卡片：`github.com/chenxuyaun/free_web_mcp`
- 三个关键词：`free / open source / MCP compatible`
- 「点 star 关注 v3：缓存、限流、Markdown 输出、SEO 摘要。评论区告诉我你最想用哪个工具。」

## 录后

- 剪辑：剪掉等待下载/编译的空白（保留 server 启动 1-2 秒作证据）
- 配字幕：英文 SRT + 中文 SRT 双轨（B 站选中文轨，YouTube 选英文轨）
- 缩略图：黑底白字 + `web_search` 三个工具的返回截图拼成 16:9
- 标题示例：
  - 中文：「3 分钟跑通 Free Web MCP —— 给 AI Agent 的免费搜索+抓取」
  - English: "Free Web MCP in 3 minutes: web search & fetch for AI agents"

## 素材清单（执行前确认存在）

- [ ] `assets/cover.png` —— 片头卡片
- [ ] `assets/duckduckgo_results.png` —— web_search 返回截图
- [ ] `assets/wikipedia_page.png` —— web_fetch 返回截图
- [ ] `assets/spa_render_comparison.png` —— 静态 vs 渲染 对比图
- [ ] `assets/docker_health.png` —— `/health` 截图
- [ ] 一个无 bot 检测的 SPA 演示 URL（example.com 不算 SPA，建议用 `https://www.nytimes.com/` 某具体文章试一下；若反爬强可换自建 Vite demo 页面）
- [ ] Cursor / Claude Desktop 任一个能跑通 MCP 的客户端

## 备选场景（若时间充裕）

- v2 `rendered=False` vs `rendered=True` 的 `text_length` 差异对比
- respx 截图演示测试套件：`uv run pytest -q` 输出 `28 passed`
- CI 流程截图（v3 加）：`.github/workflows/ci.yml` 跑通
