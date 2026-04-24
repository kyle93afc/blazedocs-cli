# Changelog

All notable changes to the `blazedocs` CLI are documented here. This project follows [Semantic Versioning](https://semver.org/).

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
