# Contributing to free-web-mcp

Thanks for your interest. This is a small project — most contributions can land
in a single PR and a single review.

## Dev environment

Requires Python 3.12+ and [uv](https://github.com/astral-sh/uv).

```bash
git clone https://github.com/chenxuyaun/free_web_mcp.git
cd free_web_mcp
uv sync                  # installs runtime + dev deps
```

## Running the test suite

```bash
uv run pytest            # 39 tests, no real network needed
uv run ruff check .      # lint
uv run mypy              # type check (strict, src/ only)
```

CI runs the same three commands on every push — see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). PRs that don't pass CI
won't be merged.

## Architecture rules (must follow)

The codebase has a strict layering rule. **Breaking this rule is grounds for
PR rejection.**

```
MCP Tool Layer   (mcp/tools.py)
        |
        v
Service Layer    (web/search.py, web/fetch.py)
        |
        v
Provider Layer   (web/providers/*, web/client.py, web/parser.py, web/render.py)
```

- MCP tools **must not** issue HTTP requests directly. All HTTP goes through
  `WebClient` (for static) or `RenderClient` (for JS-rendered).
- MCP tools **must not** parse HTML directly. All parsing goes through
  `web/parser.py`.
- Service-layer classes are the only place that orchestrates the providers.
- Provider-layer modules are the only place that touches `httpx`,
  `trafilatura`, or `playwright`.

When you add a new search engine, add a class implementing the `SearchProvider`
protocol in `web/providers/<name>.py` and wire it into `SearchService` — do not
modify `mcp/tools.py`.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Brave search provider
fix: map httpx.ConnectTimeout to TIMEOUT not FETCH_FAILED
docs: clarify webmcp origin trial scope
refactor: extract _extract_source_domain helper
test: cover web_summarize_with_sources inline-html path
chore: bump ddgs to 9.16
perf: cache identical web_search queries for 60s
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`,
`ci`. Scope is encouraged but optional.

## Pull requests

1. Fork, branch, commit. Use the conventional-commit format above.
2. Push the branch, open a PR against `main`.
3. CI must be green. Lint + mypy + pytest all run automatically.
4. The PR description should explain **why** the change is needed, not just
   **what**. A reviewer should be able to understand motivation from the
   description alone.
5. Keep PRs small. <500 lines of diff is a soft target. If your change is
   bigger, split it.

## Code style

- Ruff is the source of truth for formatting. `uv run ruff check .` must pass.
- Type hints are required on all public functions. mypy is `strict` on `src/`.
- Use `from __future__ import annotations` in any module with forward refs.
- Prefer small, pure functions in `web/parser.py` and `web/search.py`; push
  I/O into the provider layer.
- Tests for a new provider go in `tests/test_provider_<name>.py`. Tests for
  service-level behavior go in `tests/test_search.py` / `tests/test_fetch.py`.
  End-to-end MCP behavior goes in `tests/test_mcp.py`.

## Adding a new MCP tool

1. Add the tool function in `src/free_web_mcp/mcp/tools.py` inside
   `register_tools()`. Use `Annotated[T, Field(...)]` for parameters.
2. Add `@server.tool(name=..., title=..., description=..., annotations=READ_OPEN)`.
3. Add the tool's JSON-returning shape to the docstring so the agent can act
   on it.
4. Update the tool list in `README.md` and `docs/tools.md`.
5. Add at least one test in `tests/test_mcp.py` that exercises both the
   success path and the error-wrapping path.
6. Update `tests/test_mcp.py::test_list_tools` to include the new tool name
   in the asserted set.
7. Update `CHANGELOG.md`.

## Reporting bugs

Use the GitHub issue templates (`.github/ISSUE_TEMPLATE/bug_report.md`).
Include: OS, Python version, command you ran, expected vs actual, full
`uv run` / `pytest` output.

## Security

See [`SECURITY.md`](SECURITY.md). **Do not** open a public issue for
vulnerabilities.
