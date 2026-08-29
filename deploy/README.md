# Deploying Free Web MCP to your own server

Target: one Linux server (Ubuntu 22+, ≥2GB RAM) with Docker, a domain you
control, ports 80/443 open. Result: HTTPS dashboard + MCP server on your
domain, persistent SQLite, no third-party platform.

## One-time server setup

```bash
# Docker (skip if already installed)
curl -fsSL https://get.docker.com | sh

# firewall: allow web traffic (adjust to your provider's security group too)
sudo ufw allow 80 && sudo ufw allow 443
```

## DNS

Add an **A record** pointing your domain (e.g. `mcp.example.com`) to the
server's public IP. Wait for it to resolve:

```bash
dig +short your-domain.com   # should print the server IP
```

## Deploy

```bash
git clone https://github.com/chenxuyaun/free_web_mcp.git && cd free_web_mcp

# 1. Fill config (DOMAIN + WALLET_PRIVATE_KEY are the important ones)
cp deploy/.env.example deploy/.env
nano deploy/.env

# 2. Build + start everything
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# 3. Watch Caddy obtain the HTTPS certificate (first start only)
docker compose -f deploy/docker-compose.yml logs -f caddy
```

## Verify

```bash
curl https://your-domain.com/api/health          # Next.js dashboard health
curl https://your-domain.com/health              # MCP server health
curl -X POST https://your-domain.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'
```

Then open `https://your-domain.com` — the dashboard's status board should show
all services ONLINE with Blockchain CONNECTED, and **Run Demo** works remotely.

## Point MCP clients at it

```
https://your-domain.com/mcp
```

Works in ChatGPT Connectors, Claude Desktop (`"url": "https://your-domain.com/mcp"`),
Cursor, and any Streamable-HTTP MCP client.

## Operations

```bash
# update to latest main
git pull && docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# logs
docker compose -f deploy/docker-compose.yml logs -f web
docker compose -f deploy/docker-compose.yml logs -f mcp

# evidence DB lives in the named volume `web-data` — survives redeploys
```

## Notes

- HTTPS certificates are issued and renewed automatically by Caddy
  (Let's Encrypt) — no manual cert handling.
- Unlike Render's free tier: no spin-down, no ephemeral disk, no card.
- The signer key in `deploy/.env` is a **testnet-only** key. Never put a
  mainnet key there; the file is git-ignored.
