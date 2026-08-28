# Adding free-web-mcp to ChatGPT (Connectors)

ChatGPT (web and the Atlas in-app browser) supports remote MCP servers via the
Connectors UI. As of 2026, this requires **one-time user action** — there is
no auto-discovery from arbitrary websites.

## Steps

1. Open ChatGPT (web or Atlas) and log in.
2. Go to **Settings → Connectors** (in the "Personalization" or "Beta
   features" section, depending on the build).
3. Click **Add Connector** (or **Add MCP server** in newer builds).
4. Paste the URL:
   ```
   https://mononuclear-polytonally-clifton.ngrok-free.dev/mcp
   ```
5. Save. ChatGPT will perform an MCP `initialize` handshake; the server
   reports:
   - `name`: `free-web-mcp`
   - `protocolVersion`: `2025-06-18`
6. Start a new chat. The four tools (`web_search`, `web_fetch`,
   `web_search_and_fetch`, `web_summarize_with_sources`) are now available
   to the assistant.

## Trying it out

In a new chat, send one of these:

> Use `web_search` to find the latest news about "model context protocol" and
> list the top 3 results with their `source_domain` and `confidence` score.

> Use `web_fetch` to grab https://en.wikipedia.org/wiki/Model_Context_Protocol
> and tell me: is the source authoritative? Look at `meta.domain_type` and
> `meta.published_at`.

> Use `web_summarize_with_sources` on
> https://en.wikipedia.org/wiki/Model_Context_Protocol and report how many
> primary / secondary / tertiary links the page has.

## Removing the connector

Settings → Connectors → find `free-web-mcp` → Remove.

## Security note

Anyone with the URL can drive arbitrary HTTP requests through `WebClient` (via
`web_fetch` / `web_search_and_fetch`). The server is unauthenticated by
design. Do not point it at private internal networks. The live URL above is
public; treat it as such.
