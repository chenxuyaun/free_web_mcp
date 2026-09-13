# 124 上的真实拓扑（2026-09-13 实测确认）

这份文档存在的理由：部署走过弯路，而弯路的原因是**假设**而非实测。下面每一行都是在
124 上验证过的现状，不是设计意图。

## 服务与进程

| 部件 | 跑在哪 | 监听 | 部署方式 |
|---|---|---|---|
| 证据看板（Next.js） | Docker 容器 `free-web-mcp-web-1` | `0.0.0.0:3100`（容器内 3000） | 镜像 `free-web-mcp/web:latest`，compose 栈在 `/home/ubuntu/free-web-mcp` |
| 证据引擎/API | 同上（同一容器） | — | — |
| MCP 服务器（公开入口） | systemd 单元 `free-web-mcp-mcp` | `127.0.0.1:10000` | 源码 `/home/ubuntu/free_web_mcp`，`uv run --no-sync free-web-mcp` |
| MCP 服务器（compose 内部用） | Docker 容器 `free-web-mcp-mcp-1` | `0.0.0.0:8766` | 镜像 `free-web-mcp/mcp:latest`（看板 `/api/demo` 用它） |
| 反向代理 | 宿主 nginx | 443 | `yuncai.site`，片段 `snippets/free-web-mcp.conf` |

**两个 MCP 实例是故意的**（历史原因）：`/mcp` 走 systemd 那个（源码可改、重启快），
看板自身的 demo/agent 路由走 compose 那个。两者不冲突，因为端口不同。

## 反向代理与访问密钥

`/etc/nginx/snippets/free-web-mcp.conf`（仓库源：`deploy/124/nginx-yuncai-webmcp.conf`）：

- `/mcp` → `127.0.0.1:10000`，**所有方法都要 `X-API-Key`**
- `/webmcp/api/` → `127.0.0.1:3100`，**只有写方法要 `X-API-Key`**（读开放，看板页面才能用）
- `/webmcp/`（页面/静态资源）→ 不挡
- `/mcp-health` → `127.0.0.1:10000/health`，保持开放供探活

密钥文件：`/home/ubuntu/free_web_mcp/.webmcp-api-key`（0600，脚本生成后复用）。
两处必须相同：compose 栈的 `.env` 里 `DASHBOARD_API_KEY`、MCP systemd 单元的 `MCP_API_KEY`。
客户端（prompt-helper）在设置页「访问密钥」填同一个值。

## 改动的标准流程

- **改看板代码** → `deploy/124/rebuild-web-image.sh`（拉码 → 构建镜像 → 重建容器 → 自测）
- **改 MCP 代码** → `cd /home/ubuntu/free_web_mcp && git pull && sudo systemctl restart free-web-mcp-mcp`
- **改 nginx** → 改仓库里的 `deploy/124/nginx-yuncai-webmcp.conf`（`<API_KEY>` 换成真值）→ 传到
  `/etc/nginx/snippets/free-web-mcp.conf` → `sudo nginx -t && sudo systemctl reload nginx`

## 踩过的坑（都是实测出来的）

1. **容器启动命令不能用 `pnpm exec`**：运行镜像里有 corepack 但没有缓存的 pnpm，启动时会去
   `registry.npmjs.org` 下载；容器 DNS 一抖动就是 `EAI_AGAIN` 崩溃循环（看板整个挂掉）。
   现在 compose 里直接 `node /app/apps/web/node_modules/next/dist/bin/next start`。
2. **`.bin/next` 是 shell 包装脚本**，不能用 `node` 直接执行；要用
   `apps/web/node_modules/next/dist/bin/next` 这个真正的 JS 入口。
3. **容器内构建缺 pnpm 时别用 systemd 再部署一份**：早期 `resume-124.sh` 的 web 部分会建
   systemd 单元并抢 3100，结果是两个 dashboard 并存；我曾经把 systemd 那份的响应当成容器
   的响应，误判「middleware 没生效」。现在那份单元已 `disable --now`。
4. **apt 从国内拉 deb.debian.org 极慢**：镜像构建要 `--build-arg APT_MIRROR=mirrors.tuna.tsinghua.edu.cn`
   （Dockerfile 已支持该参数，默认仍是官方源）。
5. **两个目录别混**：源码 `/home/ubuntu/free_web_mcp`（下划线，git），compose 栈
   `/home/ubuntu/free-web-mcp`（连字符，只有 compose 文件 + .env）。改错地方不会生效。

## 验证清单（部署后照抄执行）

```bash
KEY=$(sudo cat /home/ubuntu/free_web_mcp/.webmcp-api-key)
curl -s -o /dev/null -w "%{http_code}\n" https://yuncai.site/webmcp/api/evidence                    # 期望 200（读开放）
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yuncai.site/webmcp/api/anchor/EV-000001 \
  -H 'Content-Type: application/json' -d '{"confirm":true}'                                          # 期望 401（写要密钥）
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yuncai.site/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'                                                # 期望 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://yuncai.site/mcp -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"v","version":"1"}}}'  # 期望 200
curl -s https://yuncai.site/mcp-health                                                                # 期望 status ok
```
