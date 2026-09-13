#!/usr/bin/env bash
# 重建并部署 124 上的**看板**镜像（这正是生产路径：docker compose）。
#
# 为什么单独有这个脚本：resume-124.sh 里的 pnpm build + systemd 那套是早期试错的产物，
# 与既有的 compose 部署重复且会抢 3100 端口（实测：两个 dashboard 同时存在，端口冲突，
# 而且我一度把 systemd 那份的响应当成容器的响应，误判了 middleware 是否生效）。
# 124 上的真实拓扑见 deploy/124/README.md，这份脚本是看板的标准更新流程。
#
# 用法（在服务器上，或经 ssh 传入）：
#   bash deploy/124/rebuild-web-image.sh
set -euo pipefail

REPO=/home/ubuntu/free_web_mcp          # 源码（git checkout，含 deploy/）
STACK=/home/ubuntu/free-web-mcp         # compose 栈（docker-compose.yml + .env，含钱包密钥）
KEYFILE=$REPO/.webmcp-api-key

echo "==> 1/4 取最新源码"
cd "$REPO"
git fetch origin && git reset --hard origin/main
git log --oneline -1

echo "==> 2/4 构建看板镜像（国内走清华 apt 源）"
sudo systemctl stop webbuild 2>/dev/null || true
sudo systemctl reset-failed webbuild 2>/dev/null || true
# 前台构建：要看到失败原因；用 tuna 源是因为 deb.debian.org 从这台机器上极慢。
sudo docker build \
  --build-arg APT_MIRROR=mirrors.tuna.tsinghua.edu.cn \
  -f "$REPO/deploy/web.Dockerfile" \
  -t free-web-mcp/web:latest "$REPO"

echo "==> 3/4 确保密钥两边一致（边缘 nginx 与容器应用层用同一个）"
KEY="$(sudo cat "$KEYFILE")"
grep -q '^DASHBOARD_API_KEY=' "$STACK/.env" || echo "DASHBOARD_API_KEY=$KEY" | sudo tee -a "$STACK/.env" >/dev/null
sudo grep -q 'DASHBOARD_API_KEY' "$STACK/.env" && echo "compose .env 有密钥"

echo "==> 4/4 重新创建看板容器"
cd "$STACK"
sudo docker compose up -d web
sleep 12
sudo docker ps --filter "label=com.docker.compose.service=web" --format "{{.Status}}"
echo
echo "自测（直连容器，绕开 nginx）："
printf "  读接口(应 200): "; curl -s -m 10 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/webmcp/api/evidence
printf "  写接口(应 401): "; curl -s -m 10 -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3100/webmcp/api/anchor/EV-000001 -H 'Content-Type: application/json' -d '{"confirm":true}'
echo
echo "⚠ 容器启动命令必须是 node /app/apps/web/node_modules/next/dist/bin/next start …"
echo "  （用 pnpm exec 会让 corepack 在启动时联网下载 pnpm，DNS 抖动即崩溃循环 —— 实测过）"
