# Changelog

All notable changes to the `blazedocs` CLI are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [3.0.0-beta.6] — 2026-04-24

### Changed

- **CLI conversions now upload PDFs as multipart form-data instead of base64 JSON.** This matches the public API docs and avoids base64 inflating request bodies by roughly one third.

## [3.0.0-beta.5] — 2026-04-24

### Fixed

- **Failed conversions no longer risk empty stderr under bursty subprocess runs.** Renderer writes now use synchronous fd writes for real stdout/stderr so the CLI cannot drop a short error message immediately before `process.exit()`.
- **429 responses now produce explicit rate-limit/quota guidance.** Empty or generic 429 API responses render as “Rate limit or quota exceeded (429 Too Many Requests)” with a retry-delay/quota-check hint.
- **413 responses now explain file-size failures.** Empty or generic 413 API responses render as “File too large (413 Request Entity Too Large)” instead of a generic API error.

## [3.0.0-beta.4] — 2026-04-24

### Added

- **Built-in agent skill install.** `blazedocs skills install` writes the bundled, version-matched BlazeDocs skill to the skill.sh-compatible universal path: `~/.agents/skills/blazedocs/SKILL.md`.
- **Custom skill target support.** `blazedocs skills install --target-dir ~/.claude/skills --force` installs to another agent skill root or directly to a `blazedocs` skill directory.
- **Interactive menu install option.** Running plain `blazedocs` now includes “Install agent skill” so humans can set up both API auth and agent docs from the welcome UI.

## [3.0.0-beta.3] — 2026-04-24

### Fixed

- **First-run auth guidance now points humans to `blazedocs`.** Auth errors, README onboarding, doctor partial-config hints, and the bundled agent manual now tell interactive users to run plain `blazedocs` for guided setup. The non-interactive `login --api-key-stdin` path remains documented for agents and CI.

## [3.0.0-beta.2] — 2026-04-24

### Added

- **First-run human onboarding.** Running `blazedocs` in an interactive terminal now shows a branded welcome screen, prompts for an API key on first run, validates it, and then opens a small menu for convert/usage/login/doctor.
- **Interactive `convert` flow.** `blazedocs convert` with no input now opens a PDF picker in TTY mode and asks where to write the Markdown. Non-TTY and explicit input paths remain pipe-safe.
- **Clack password prompt.** `blazedocs login` now uses `@clack/prompts.password()` for masked API-key entry instead of the previous readline monkeypatch.
- **TTY quota display.** `usage`, `whoami`, and login success now show a compact quota bar under the Clack renderer.
- **Terminal-safe wordmark.** The welcome screen now renders a big ASCII BlazeDocs logo that keeps the v3 first-impression feel without Unicode block wrapping in desktop terminals.

### Preserved

- `--json`, `--raw`, `--silent`, and non-TTY behavior remain agent-safe.
- `--version` / `--help` still avoid loading UI/API modules; the lazy-import guard remains in place.
- `blazedocs init` remains killed and rejected as an unknown command.

## [3.0.0-beta.1] — 2026-04-24

**Agent-first edition.** v3 reframes BlazeDocs CLI as a surface for AI agents first, humans second. Inspired by `microsoft/playwright-cli` and `vercel-labs/agent-browser`, driven by Sequoia's ["Services as Software" thesis](https://sequoiacap.com/article/services-the-new-software/). Every invocation is now structured, deterministic, and pipe-friendly.

### Breaking changes (the reason for the major)

- **`convert <file> --json` output is now a JSONL envelope.** v2.0.3 emitted the raw API response on stdout; v3 emits `{"type":"result","data":{...<same fields>...}}`. Multi-file convert emits one JSONL line per file. This is the only breaking change — any pipeline running `blazedocs convert x.pdf --json | jq .markdown` must switch to `jq .data.markdown`.
- **Global flags `--json` / `--raw` / `--silent` / `--yes`.** These now live on `blazedocs` itself, not per-subcommand. `--json` was only on `usage` and `convert` in v2.0.3; now it's available on every command.
- **`promptSecret` removed from `src/prompt.ts`.** The file is renamed to `src/stdin.ts` and only exports `readStdinAll`. Internal change — only affects direct programmatic consumers (the public CLI surface is unchanged).

### New — for agents

- **Structured error output.** Under `--json`, fatal errors emit one JSONL line to stderr: `{"error":{"code":"AUTH_REQUIRED","message":"...","hint":"...","exit_code":3}}`. Stable error codes: `AUTH_REQUIRED`, `QUOTA_EXCEEDED`, `NETWORK_ERROR`, `API_ERROR`, `FILE_NOT_FOUND`, `INVALID_ARGS`, `SKILL_NOT_FOUND`, `INTERNAL`. Agents pattern-match on `code`; the enum is load-bearing and won't change without another major.
- **`--raw` global flag.** Emits pure payload to stdout (markdown for `convert`, no envelope, no newline added). Errors on stderr as `[AUTH_REQUIRED] message\n`, parseable with `/^\[([A-Z_]+)\] /`. Pipeline-friendly like `playwright-cli --raw`.
- **`blazedocs doctor` command.** Runs 7 self-diagnostic checks in parallel (auth, config integrity, network, node version, config perms, disk space, CLI version). Agents call `doctor --json` after a failure to decide the recovery path: re-auth, retry, or escalate. Doctor itself always exits 0; the overall status is in `data.overall`.
- **`blazedocs skills get core`.** Emits the full 350-line agent operations manual on stdout. Agents load this once to understand every command, flag, exit code, and common workflow. Content is version-synced with the installed binary — no network dependency.
- **`blazedocs skills list`.** Enumerates available skills.
- **Upgrade notification in JSON envelope.** When a newer version is available, the last JSONL line is `{"type":"meta","upgrade":{"available":true,"current":"3.0.0","latest":"3.1.0","install_cmd":"npm i -g blazedocs@latest"}}`. Agents can tell their user or self-upgrade if authorized. TTY humans see a boxed "Update Available" notice on stderr.
- **Global kebab-case flag audit.** Every CLI flag is kebab-case. camelCase flags rejected at parse time. Covered by regression tests.

### New — for humans

- **`blazedocs whoami --json`** — was missing in v2.0.3.
- **`blazedocs login` emits richer success shape** — includes `{ok, email, tier, pages_used, pages_limit, pages_remaining}` under `--json`.
- **Config file gains optional `installedAt` field.** Reserved for v3.1's update-check cadence logic. No breaking change; existing configs continue to work.
- **API keys redacted from every output.** `bd_live_*` and `bd_test_*` prefixes are stripped from any `message` or `hint` field before stdout/stderr emission.

### Architecture

- **Renderer abstraction.** Four implementations (`json`, `silent`, `raw`, `clack`) switch on global flags + TTY. Commands never read `opts.json`/`opts.raw`/`opts.silent` — they receive a `Renderer` and call `.success()`/`.error()`/`.progress()`/`.note()`. Eliminates 4x if-else ladders in every command.
- **`bin/blazedocs.ts` is now lazy.** Only `commander` is eagerly imported at the top level; every command handler and UI module is `await import(...)` inside its `.action()` callback. `--version` and `--help` never load clack, picocolors, semver, or the API layer — budget ≤200ms cold. Enforced by a static import-graph test.
- **Upgrade check is a direct `fetch`** to `registry.npmjs.org`, not an `npm view` subprocess. 500ms `AbortController` timeout. Cache at `~/.blazedocs/update-check.json`, 24h TTL, atomic rename to prevent torn writes under parallel invocations.
- **`BLAZEDOCS_INTERACTIVE=0`** forces non-interactive mode regardless of TTY state. Replaces the per-agent env-var sniffing approach (unverifiable).
- **`BLAZEDOCS_SKIP_UPDATE_CHECK=1`** bypasses the registry probe (CI, air-gapped).
- **`BLAZEDOCS_ASCII_LOGO=1`** forces ASCII fallback over Unicode block characters.

### Deferred

- `blazedocs skills add <target-dir>` — writes a shell-out stub pointing at `skills get core` (codex outside-voice review flagged the security surface; beta.1 ships without it).
- Full `@clack/prompts` TTY polish: ANSI banner, boxed welcome/usage/whoami, interactive no-args menu, `password()` prompt for login. Renderer interface stays stable; polish upgrades in place.
- Markdown preview in terminal after convert (TTY only).
- Clipboard copy on success.
- Rotating tips on success.
- Shell completion scripts.

### Dependencies added

- `@clack/prompts ^0.11.0` — used by ClackRenderer (progress/success/error/note lines) and the Phase 2 polish.
- `picocolors ^1.1.1` — ANSI color with automatic TTY/NO_COLOR detection.
- `semver ^7.6.3` — version comparison for the upgrade check.
- `@types/semver ^7.5.8` — dev-only.

Pack size target: ≤250KB (was ~40KB in v2.0.3; ~146KB of deps added). CI should fail if exceeded.

### Test coverage

20 tests in v2.0.3 → **86 tests in 3.0.0-beta.5**. New suites:
- `renderers.test.ts` — 21 unit tests for json/silent/raw/clack with fake streams.
- `upgrade-check.test.ts` — 8 tests (mocked fetch, cache TTL, corrupt-file recovery).
- `json-stream-contract.test.ts` — 5 E2E tests proving stdout/stderr stream separation.
- `version-import-guard.test.ts` — 2 static-analysis tests enforcing the lazy-import rule.
- `convert-regression.test.ts` — 9 E2E tests locking v2.0.3 behavior (with in-process mock API).
- `doctor-and-skills.test.ts` — 8 E2E tests for the new commands.

All 20 existing tests still pass unchanged.

## [2.0.3] — 2026-04-24

### Fixed

- **Tier name now matches the public billing SKU.** The backend returns `tier: "business"` as an internal slug for the public "Enterprise" plan. `blazedocs whoami` and `blazedocs usage` previously echoed the raw slug, so a paying Enterprise customer would see `business plan` in the CLI even though they were looking at Enterprise on the pricing page and in the dashboard. Output now reads `Enterprise plan — …`. A `displayTier()` helper is exported for anyone doing their own mapping. Remove the CLI-side map once the server unifies the tier field (tracked in the monorepo TODOs under "Unified error contract").

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
