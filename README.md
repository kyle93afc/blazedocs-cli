# blazedocs

Command-line tool to convert PDFs to Markdown via the [BlazeDocs](https://blazedocs.io) API. Preserves tables, lists, and document structure. Works on scanned and image-based PDFs.

## Install

```bash
# Run without installing
npx blazedocs convert report.pdf --output report.md

# Or install globally
npm install -g blazedocs
```

Requires Node.js 18 or later.

## Authenticate

Get a free API key at https://blazedocs.io/dashboard/api. Then:

```bash
# Interactive (hidden-input prompt)
blazedocs login

# Non-interactive — pipe via stdin
echo "$MY_KEY" | blazedocs login --api-key-stdin

# Or export directly (CI / agents)
export BLAZEDOCS_API_KEY="bd_live_..."
```

The key is stored at `~/.blazedocs/config.json` with mode `0600`. Env var beats config file.

## Commands

```bash
blazedocs convert <file-or-url...> [--output <path>] [--json] [--silent]
blazedocs usage [--json]
blazedocs whoami
blazedocs login [--api-key-stdin]
blazedocs logout
```

### Convert examples

```bash
# Single file, explicit output path
blazedocs convert ~/Downloads/report.pdf --output ~/report.md

# Multiple files into a directory (trailing slash matters)
blazedocs convert a.pdf b.pdf c.pdf --output results/

# From a URL
blazedocs convert https://example.com/paper.pdf --output paper.md

# Stream to stdout
blazedocs convert report.pdf | head -50

# JSON response (for programmatic use)
blazedocs convert report.pdf --json > report.json
```

## Exit codes

| Code | Meaning                                          |
|------|--------------------------------------------------|
| 0    | Success                                          |
| 1    | Generic failure (file not found, network error)  |
| 2    | Quota exceeded — upgrade to continue             |
| 3    | Authentication failed — run `blazedocs login`    |

## Agent Skill

This package ships with an [Agent Skills](https://agentskills.io) definition at `skills/blazedocs/SKILL.md`. Any skills-compatible agent (Claude Code, Codex, Cursor, etc.) can load it:

```bash
npx skills add https://github.com/kyle93afc/blazedocs-cli --skill blazedocs
```

After install, the agent knows how to authenticate, convert PDFs, check quota, and handle errors without further prompting.

## No retry

The CLI does not retry on transient failures. `POST /api/v1/convert` is not idempotent on the server yet — retry on network timeout could double-bill. Idempotency-Keys are on the roadmap; retry will return once they ship.

## Links

- Homepage: https://blazedocs.io
- API docs: https://blazedocs.io/api-docs
- Issues: https://github.com/kyle93afc/blazedocs-cli/issues
- Support: support@blazedocs.io

## License

MIT
