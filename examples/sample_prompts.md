# Sample prompts for free-web-mcp

Paste any of these into a chat connected to the server.

## web_search

1. Search the web for "model context protocol" with `max_results=5` and tell
   me the `source_domain` of each result.
2. Find recent news about the EU AI Act, top 3 results, ranked by your
   confidence in the source.
3. Look up "trafilatura python" and pick the one result from a `.org` or
   `.gov` domain. Summarize what it is.

## web_fetch

4. Fetch https://en.wikipedia.org/wiki/Model_Context_Protocol and tell me:
   what is the `domain_type`? When was it `published_at`? Is HTTPS used?
5. Fetch this blog post: https://example.com/some-post. If `published_at`
   is older than 2 years, warn me before I cite it.
6. Use `web_fetch` to grab https://en.wikipedia.org/wiki/Anthropic. Look at
   `meta.author` and the page's own attribution; do they agree?

## web_search_and_fetch

7. Search "EU AI Act" and fetch the top 3 results in one call. For each
   fetched page, report the title, the `meta.published_at`, and the
   `meta.domain_type`.
8. Find "react server components" tutorials, fetch the top 2, and for each
   one quote a paragraph that defines the term.

## web_summarize_with_sources

9. Run `web_summarize_with_sources` on
   https://en.wikipedia.org/wiki/Model_Context_Protocol. Report the
   `counts: {primary, secondary, tertiary}` and list 2 tertiary links.
10. Run it on a news article you just fetched (pass the URL). Tell me
    whether the article cites any primary sources vs. only other news outlets.

## Combining tools

11. Search "WHO monkeypox 2024" with `web_search`, pick the WHO result, then
    run `web_summarize_with_sources` on it. Report the secondary vs. tertiary
    ratio and what that tells us about how authoritative the page is.
12. Fetch a page with `web_fetch`, then use `web_summarize_with_sources` on
    the same URL and cross-check that the authors match.

## Failure-mode prompts (good for demos)

13. Fetch "not-a-url" — expect a wrapped `INVALID_URL` error.
14. Search with `max_results=0` (below the 1-min clamp) — the server clamps
    to 1. Show me what came back.
15. Fetch `https://example.com/this-does-not-exist` — expect HTTP 404 mapped
    to `HTTP_ERROR`.
