## What

<!-- One-paragraph summary of the change. -->

## Why

<!-- The user-facing or maintainer-facing problem this solves. -->

## How verified

<!-- Tick what you ran before opening this PR. CI will run the same checks. -->

- [ ] `uv run pytest` (all green)
- [ ] `uv run ruff check .`
- [ ] `uv run mypy`
- [ ] For new public functions: type hints, docstrings
- [ ] For new tools: JSON-schema example in the docstring
- [ ] For bug fixes: a regression test that fails on `main` and passes here
- [ ] For provider changes: tested against the real provider, not just mocked

## Scope check

- [ ] No new top-level deps without discussion in the issue first
- [ ] No changes to `mcp/tools.py` for things that belong in `web/` (or vice versa)
- [ ] No PII / API keys / cookies added to logs

## Breaking changes

<!-- List any breaking API or schema changes. If none, write "None". -->
