---
name: blazedocs
description: Use when the user needs to convert a PDF to Markdown, extract text or tables from a PDF (including scanned or image-based PDFs), OCR a document, or ingest PDF content into a knowledge base, RAG pipeline, or note-taking vault (Obsidian, Notion, Logseq). Wraps the `blazedocs` CLI, which calls the BlazeDocs API (preserves tables and document structure). Works on local PDF files and http/https URLs. Typical invocation - `npx blazedocs convert <path-or-url> --output <dir>`.
metadata:
  short-description: Convert PDFs to Markdown via the BlazeDocs CLI
---

# BlazeDocs CLI

Convert PDFs to Markdown via the `blazedocs` command-line tool. Follow the sections in order — this matches the actual flow of using the tool.

## 1. Installation verification

Before running any other command, confirm the CLI is available:

```bash
npx blazedocs --version
```

Expected output - a semver string like `2.0.0`. If this fails with "command not found" or similar, the user does not have the CLI installed. Tell them to run `npx blazedocs <command>` directly (no install needed) or `npm install -g blazedocs` for a persistent install. Do not attempt to install globally without asking.

Requires Node.js 18 or later. If `npx` itself is missing, the user must install Node.js first.

To install this skill locally for agents that read skill.sh-compatible skill
directories, run:

```bash
npx blazedocs@beta skills install
```

Default target: `~/.agents/skills/blazedocs/SKILL.md`. For a specific agent
skill root, use:

```bash
npx blazedocs@beta skills install --target-dir ~/.claude/skills --force
```

## 2. Authentication

The CLI needs a BlazeDocs API key. Check for credentials in this order:

```bash
# Preferred - verify the user is already logged in
npx blazedocs whoami
```

Output on success - the user's email and plan (e.g. `kyle@example.com (Pro plan)`). On failure - `Not authenticated.`

If not authenticated, the user has three options. Do NOT pass the key on the command line (it leaks to process listings and shell history):

1. **Interactive login** (preferred for humans):
   ```bash
   npx blazedocs
   ```
   Prompts for the key with hidden input, validates it against the API, stores it in `~/.blazedocs/config.json` with mode 0600.

2. **Pipe from stdin** (preferred for automation):
   ```bash
   echo "$MY_KEY" | npx blazedocs login --api-key-stdin
   ```

3. **Environment variable** (preferred for CI/agents):
   ```bash
   export BLAZEDOCS_API_KEY="bd_live_..."
   ```
   The CLI reads `BLAZEDOCS_API_KEY` on every invocation. No `login` needed. Precedence - env var beats config file.

API keys start with `bd_live_` or `bd_test_`. Users get one from https://blazedocs.io/dashboard/api (requires a free BlazeDocs account).

## 3. Core command - convert a PDF

The command the user almost always wants:

```bash
npx blazedocs convert <path-or-url> --output <output-dir-or-file>
```

Behavior:
- `<path-or-url>` accepts a local file path OR an http/https URL. The CLI downloads URL inputs before sending.
- `--output <file.md>` writes the markdown to that file.
- `--output <dir/>` (trailing slash OR existing directory) writes `<basename>.md` inside that directory.
- Without `--output`, markdown streams to stdout. Safe to pipe - broken pipe (`| head`) is handled without errors.
- Multiple files - `npx blazedocs convert a.pdf b.pdf c.pdf --output results/` creates `results/` and writes `a.md`, `b.md`, `c.md`.

Other flags:
- `--json` returns the full API response as JSON (useful when you need `page_count`, `token_count`, `processing_time_ms`, `usage.pages_remaining`).
- `--silent` suppresses progress spinners (useful for pipelines and CI).

## 4. Check quota and identity

Before converting many PDFs or running in a batch, verify quota:

```bash
npx blazedocs usage
```

Output - current-month pages used, pages limit, pages remaining, tier (free / Pro / etc.).

```bash
npx blazedocs whoami
```

Output - logged-in email and plan. Returns non-zero exit if not authenticated.

## 5. Error handling cheat sheet

The CLI throws typed errors and uses distinct exit codes. Match on exit code, not message string.

| Exit | Meaning | What to do |
|------|---------|-----------|
| 0 | Success | Markdown written as requested |
| 1 | Generic failure (file not found, invalid PDF, network error that already retried and failed) | Surface the stderr message to the user verbatim; do not retry |
| 2 | Quota exceeded (429 with `upgrade_required`) | Print the `upgradeUrl` the CLI emits and ask the user whether to upgrade. Do NOT retry - the next call will fail identically until billing changes |
| 3 | Authentication failed (401) | Suggest `npx blazedocs` for humans, or `BLAZEDOCS_API_KEY` / `login --api-key-stdin` for agents; do not retry |

Specific errors you may see on stderr:

- `Not authenticated. Run 'blazedocs' to set up BlazeDocs, or set BLAZEDOCS_API_KEY.` - auth not configured; go to Section 2
- `File not found: <path>` - verify path; check for typos and relative-path issues (CLI resolves relative to cwd)
- `Monthly page limit reached. Upgrade - <url>` - quota exhausted; stop batch conversions
- `Invalid PDF file` - file is corrupt, password-protected, or not actually a PDF
- `File too large - max 10MB on free tier, 50MB on Pro` - plan limit

**Do NOT retry on any error automatically.** The CLI does not add retry logic because POST /api/v1/convert is not idempotent on the server - a retry on network timeout could double-bill the user. Always surface the error and let the user decide.

## 6. Escape hatch - raw API call

If the CLI does not expose what you need, call the API directly:

```bash
curl -X POST https://blazedocs.io/api/v1/convert \
  -H "Authorization: Bearer $BLAZEDOCS_API_KEY" \
  -F "file=@document.pdf"
```

Response shape:
```json
{
  "success": true,
  "data": {
    "markdown": "...",
    "page_count": 4,
    "token_count": 38094,
    "processing_time_ms": 1739,
    "file_name": "document.pdf"
  },
  "usage": {
    "pages_used": 859,
    "pages_limit": 10000,
    "pages_remaining": 9141
  }
}
```

Note: the markdown field is at `result.data.markdown`, NOT `result.markdown`. Earlier CLI versions (v1.1.0 and below) had a parsing bug here that wrote empty files. v2.0.0 and later are correct.

## 7. Constraints - when to ask the user first

Ask the user before doing any of these:

- **Bulk conversions (>10 files in one run)** - confirm the user is aware of quota cost; run `blazedocs usage` first and report remaining pages.
- **Conversions that will exceed remaining quota** - if the sum of page counts in the batch will exceed `pages_remaining` from `usage`, stop and tell the user how many files will succeed before the quota hits.
- **Writing output to the user's vault, home directory, or shared drives** - confirm the target path; do not auto-create sprawling folder structures.
- **Running `blazedocs logout`** - this clears stored credentials. Confirm the user actually wants to log out (common case - they do not, they just hit the wrong command).

## 8. Examples

Three copy-pasteable invocations covering the common cases.

**Single file, save to a specific path:**
```bash
npx blazedocs convert ~/Downloads/report.pdf --output ~/Documents/report.md
```

**Batch conversion into a directory:**
```bash
mkdir -p ~/Documents/converted
npx blazedocs convert ~/Downloads/*.pdf --output ~/Documents/converted/
```

**Stream to stdout and pipe into another tool (here, Claude Code's scratch):**
```bash
npx blazedocs convert https://example.com/paper.pdf --silent | head -100
```

## 9. What this skill does NOT do

- Does not handle image extraction. The public API returns markdown text only; image references in the output (`![img-0.jpeg](...)`) do not resolve to real files. If the user needs extracted images linked into an Obsidian Attachments folder, tell them image extraction is on the BlazeDocs roadmap but not in v2.0.0.
- Does not support `--format obsidian` or `--pages "1-5"` flags yet. The flags were removed from v2.0.0 because the server does not honor them. Do not hallucinate either flag in a command.
- Does not convert non-PDF files. Input must be a PDF. For Word documents, spreadsheets, or images, the user needs a different tool.

## 10. Where to get help

- CLI help - `npx blazedocs --help` or `npx blazedocs <command> --help`
- API docs - https://blazedocs.io/api-docs
- Support - support@blazedocs.io (the user's email will go to the BlazeDocs team)
- Source - https://github.com/kyle93afc/blazedocs-cli
