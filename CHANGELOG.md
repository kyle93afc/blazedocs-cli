# Changelog

All notable changes to the `blazedocs` CLI are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [2.0.2] — 2026-04-24

### Fixed

- **`usage` command showed 0/0/0 pages instead of real quota.** The BlazeDocs API's `GET /api/v1/convert` returns usage nested as `{ usage: { monthlyPages }, limits: { pages } }`, but the CLI was reading flat `pages_used` / `pages_limit` / `pages_remaining` fields (which only exist on `POST /api/v1/convert` responses). The CLI now normalizes both shapes via a new `normalizeUsage` helper. Verified end-to-end: real account with 859/10,000 pages used now prints correctly.
- **`whoami` command showed "unknown (tier plan)" — no email displayed.** The `GET /api/v1/convert` endpoint does not return an email field, so the CLI was hitting its "unknown" fallback for every user. The output is now `{tier} plan — {pages_used}/{pages_limit} pages used, {remaining} remaining` when no email is available. If the server adds an `email` field later, it will be shown instead.
- **Convert output files now end with a trailing newline.** Previously `.md` files ended mid-line (e.g. `liquor jugs.` with no `\n`), breaking POSIX conventions and breaking diff/cat behaviors on some terminals.

### Added

- **`normalizeUsage()` helper** exported from `src/api.ts` — collapses the API's nested and flat response shapes into a consistent `{ pagesUsed, pagesLimit, pagesRemaining, tier }` object. Used by `usage` and `whoami` commands.
- **4 new regression tests** in `tests/api.test.ts` covering both response shapes and the empty-response fallback.

### Known server-side issue (tracked, not fixed here)

The API's `GET /api/v1/convert` and `POST /api/v1/convert` endpoints return different shapes for the same logical data (usage + limits). This CLI release works around the divergence client-side. The server should ship a unified response contract so all clients can rely on one shape. Tracked in the monorepo's `TODOS.md` under "Unified error contract for /api/v1/*".

## [2.0.1] — 2026-04-24

### Fixed

- **Duplicate auth hint.** `blazedocs whoami` (and other commands) printed "Run `blazedocs login` or set BLAZEDOCS_API_KEY." twice on `AuthError` — once as part of the error message, once from an extra hint block in the error handler. The redundant block has been removed. Covered by a new regression test.
- **Progress message printed before file validation.** `blazedocs convert /does/not/exist.pdf` printed "Converting /does/not/exist.pdf..." before discovering the file was missing and erroring out. Local-file existence is now validated up front, so `File not found:` fires cleanly without the misleading progress line. Covered by a new regression test.

## [2.0.0] — 2026-04-24

### Breaking

- **CLI-only package.** The `blazedocs` npm package no longer exposes a programmatic SDK (`import { BlazeDocsClient } from "blazedocs"`). The SDK export in v1.1.0 was non-functional (the build was missing `sdk.js` and shipped as a broken import). It has been removed cleanly in v2.0.0. If you need programmatic access to the BlazeDocs API, call `/api/v1/convert` directly or open an issue — we'll prioritize a real SDK when there's demand.
- **Removed `--format` flag.** v1.1.0's `--format obsidian` / `--format gfm` flags were sent to the API but silently ignored server-side. They have been removed from the CLI to avoid misleading users. Server-side support is tracked for a future release.
- **Removed `--pages` flag.** Same reason as `--format` — the flag was cosmetic in v1.1.0. Server-side page-range support is tracked for a future release.
- **Removed `--api-key=VALUE` flag.** Passing an API key on the command line leaks it into process listings and shell history. Use `blazedocs login`, `--api-key-stdin`, or the `BLAZEDOCS_API_KEY` environment variable instead.

### Fixed

- **Empty `.md` output (regression from v1.1.0).** v1.1.0's convert command read `result.markdown` from the API response, but the API returns `{ data: { markdown, ... } }`. With the `|| ''` fallback in place, v1.1.0 silently wrote empty files for 23 days. v2.0.0 parses the correct path and is covered by a regression test in CI.

### Added

- **Typed error classes.** `AuthError`, `QuotaExceededError`, `NetworkError`, `ApiError` — exit codes are stable: `0` success, `1` generic failure, `2` quota exceeded, `3` authentication failed.
- **Agent Skill.** `skills/blazedocs/SKILL.md` ships in the npm tarball and is installable into any Agent Skills-compatible agent (Claude Code, Codex, Cursor, etc.) via `npx skills add https://github.com/kyle93afc/blazedocs-cli --skill blazedocs`.
- **Regression-tested response parsing, binary smoke test, and security regression** (rejects the old `--api-key=VALUE` flag) as part of `prepublishOnly`. CI publishes only if these tests pass.

### Notes

- Retry on transient failures is intentionally omitted. `POST /api/v1/convert` is not idempotent on the server yet — adding retry before server-side idempotency keys risks double-billing users on network hiccups. Idempotency-Keys are tracked as a prerequisite for safe retry.
