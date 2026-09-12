#!/usr/bin/env bash
# free_web_mcp 部署到 124 服务器（Ubuntu, nginx 已在 yuncai.site 运行）。
#
# 从本地执行（密码走交互或 $PASS）：
#   REPO_DIR=/home/ubuntu/free_web_mcp WALLET_PRIVATE_KEY=0x你的testnet私钥 \
#     ssh -p 55991 ubuntu@124.221.130.64 "bash -s" < deploy/124/deploy-124.sh
#
# 幂等：重复执行会拉取最新代码并重启服务。密钥只落在服务器上的 .env（chmod 600）。
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/free_web_mcp}"
WEB_PORT="${WEB_PORT:-3100}"
MCP_PORT="${MCP_PORT:-10000}"
WALLET_PRIVATE_KEY="${WALLET_PRIVATE_KEY:-}"
export PATH="$HOME/.local/bin:$PATH"

echo "==> 1/6 系统依赖"
command -v node >/dev/null 2>&1 || { curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -; sudo apt-get install -y nodejs; }
node -v
command -v pnpm >/dev/null 2>&1 || sudo npm i -g pnpm@10
command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh

echo "==> 2/6 代码"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin && git -C "$REPO_DIR" reset --hard origin/main
else
  git clone https://github.com/chenxuyaun/free_web_mcp.git "$REPO_DIR"
fi
cd "$REPO_DIR"

echo "==> 3/6 看板 (127.0.0.1:$WEB_PORT, basePath /webmcp)"
pnpm install --frozen-lockfile
pnpm --filter @free-web-mcp/web build
mkdir -p apps/web/data
if [ ! -f apps/web/.env.local ]; then
  if [ -z "$WALLET_PRIVATE_KEY" ]; then
    echo "⚠ 未提供 WALLET_PRIVATE_KEY —— 链上锚定暂不可用（搜索/证据功能正常），稍后补写 apps/web/.env.local 即可。"
  fi
  cat > apps/web/.env.local <<ENV
NODE_ENV=production
BSC_NETWORK=bsc-testnet
BSC_RPC_URL=https://bsc-testnet-rpc.publicnode.com
BSC_EXPLORER_URL=https://testnet.bscscan.com
EVIDENCE_REGISTRY_ADDRESS=0x19AB142cA0Aad02BB55ffB6129494926c520c60F
VERI_TOKEN_ADDRESS=0xDDcbC86dE41bB8863a4Acd929E965d0E07A54C76
WALLET_PRIVATE_KEY=$WALLET_PRIVATE_KEY
MCP_SERVER_URL=http://127.0.0.1:$MCP_PORT
ENV
  chmod 600 apps/web/.env.local
fi

echo "==> 4/6 MCP 服务器 (127.0.0.1:$MCP_PORT, EVIDENCE_API_URL 指向本机看板)"
cd apps/mcp-server
uv sync --frozen
cd "$REPO_DIR"

echo "==> 5/6 systemd 服务"
sudo tee /etc/systemd/system/free-web-mcp-web.service >/dev/null <<UNIT
[Unit]
Description=free_web_mcp web dashboard (evidence store)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$REPO_DIR/apps/web
Environment=NODE_ENV=production
ExecStart=/bin/bash -lc 'cd $REPO_DIR/apps/web && pnpm exec next start -p $WEB_PORT -H 127.0.0.1'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/free-web-mcp-mcp.service >/dev/null <<UNIT
[Unit]
Description=free_web_mcp MCP server (streamable HTTP)
After=network.target free-web-mcp-web.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$REPO_DIR/apps/mcp-server
Environment=EVIDENCE_API_URL=http://127.0.0.1:$WEB_PORT/webmcp
# ⚠ 必须带 /webmcp basePath —— 本地默认值缺这一段会导致证据创建 404（实测踩过的坑）
ExecStart=/bin/bash -lc 'cd $REPO_DIR/apps/mcp-server && uv run --no-sync free-web-mcp --transport http --host 127.0.0.1 --port $MCP_PORT'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now free-web-mcp-web.service free-web-mcp-mcp.service
sleep 5

echo "==> 6/6 健康检查"
curl -sf "http://127.0.0.1:$WEB_PORT/webmcp/api/health" >/dev/null && echo "✓ 看板  :$WEB_PORT/webmcp" || echo "✗ 看板未响应（查 journalctl -u free-web-mcp-web）"
curl -sf "http://127.0.0.1:$MCP_PORT/health" >/dev/null && echo "✓ MCP   :$MCP_PORT" || echo "✗ MCP 未响应（查 journalctl -u free-web-mcp-mcp）"

echo
echo "完成。nginx 侧把下面两段加进 yuncai.site 的 server 块（见 deploy/124/nginx-yuncai-webmcp.conf）："
echo "  location /webmcp/ { proxy_pass http://127.0.0.1:$WEB_PORT; … }"
echo "  location /mcp     { proxy_pass http://127.0.0.1:$MCP_PORT; … }"
