#!/usr/bin/env bash
# 断点续跑：从 deploy-124.sh 卡住的 4/6 继续（Python 修复 → 钱包写入 → systemd → 健康检查）。
#
# 从本地执行（把 0x 换成你的 testnet 私钥；viem 要求 0x 前缀）：
#   WALLET_PRIVATE_KEY=0x你的私钥 \
#     ssh -p 55991 ubuntu@124.221.130.64 "WALLET_PRIVATE_KEY='0x你的私钥' bash -s" < deploy/124/resume-124.sh
set -euo pipefail
# 国内网络：PyPI 走清华镜像 + 放宽超时（实测 30s 默认值不够）
export UV_DEFAULT_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"
export UV_HTTP_TIMEOUT=120
export PATH="$HOME/.local/bin:$PATH"
REPO_DIR="/home/ubuntu/free_web_mcp"
WEB_PORT=3100
MCP_PORT=10000

echo "==> 3.5/6 拉取最新代码(含访问密钥闸门)"
cd "$REPO_DIR"
git fetch origin && git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm --filter @free-web-mcp/web build

echo "==> 4/6 修复 Python 并同步 MCP 依赖"
cd "$REPO_DIR/apps/mcp-server"
echo "3.12" > .python-version
uv python install 3.12
uv sync --frozen

echo "==> 5/6 钱包 + 访问密钥写入 .env.local, systemd"
# One shared secret for both services: the MCP endpoint checks it, the dashboard checks it on
# /api/* (and the anchor route fails closed without it), and the MCP server presents it when it
# calls the dashboard. Generated once and reused on re-runs so the client config stays valid.
KEYFILE="$REPO_DIR/.webmcp-api-key"
if [ -f "$KEYFILE" ]; then
  MCP_API_KEY="$(cat "$KEYFILE")"
else
  MCP_API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d '[:space:]')"
  printf '%s' "$MCP_API_KEY" > "$KEYFILE"
  chmod 600 "$KEYFILE"
fi
echo "访问密钥: $MCP_API_KEY  (填进 prompt-helper 设置页的「访问密钥」)"
if [ -z "${WALLET_PRIVATE_KEY:-}" ]; then
  echo "✗ 没收到 WALLET_PRIVATE_KEY —— 远端命令必须形如: \"WALLET_PRIVATE_KEY='0x…' bash -s\""
  exit 1
fi
cd "$REPO_DIR"
umask 077
cat > apps/web/.env.local <<ENV
NODE_ENV=production
BSC_NETWORK=bsc-testnet
BSC_RPC_URL=https://bsc-testnet-rpc.publicnode.com
BSC_EXPLORER_URL=https://testnet.bscscan.com
EVIDENCE_REGISTRY_ADDRESS=0x19AB142cA0Aad02BB55ffB6129494926c520c60F
VERI_TOKEN_ADDRESS=0xDDcbC86dE41bB8863a4Acd929E965d0E07A54C76
WALLET_PRIVATE_KEY=$WALLET_PRIVATE_KEY
MCP_SERVER_URL=http://127.0.0.1:$MCP_PORT
DASHBOARD_API_KEY=$MCP_API_KEY
ENV

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
Environment=MCP_API_KEY=$MCP_API_KEY
ExecStart=/bin/bash -lc 'cd $REPO_DIR/apps/mcp-server && uv run --no-sync free-web-mcp --transport http --host 127.0.0.1 --port $MCP_PORT'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now free-web-mcp-web.service free-web-mcp-mcp.service
sleep 6

echo "==> 6/6 健康检查"
curl -sf "http://127.0.0.1:$WEB_PORT/webmcp/api/health" >/dev/null && echo "✓ 看板  :$WEB_PORT/webmcp" || { echo "✗ 看板未响应"; sudo journalctl -u free-web-mcp-web -n 10 --no-pager; }
curl -sf "http://127.0.0.1:$MCP_PORT/health" >/dev/null && echo "✓ MCP   :$MCP_PORT" || { echo "✗ MCP 未响应"; sudo journalctl -u free-web-mcp-mcp -n 10 --no-pager; }

echo
echo "访问密钥(填在 prompt-helper 设置页): $(cat $KEYFILE)"
echo
echo "下一步：nginx 加 location（deploy/124/nginx-yuncai-webmcp.conf），然后 prompt-helper 设置填 https://yuncai.site/mcp 与 https://yuncai.site/webmcp"
