/**
 * Silent Renderer: non-TTY default and `--silent` flag.
 *
 * Matches v2.0.3 behavior for pipe-safe automation:
 *   - progress/note → swallowed
 *   - success       → if the payload has a `markdown` or `stdout` string,
 *                     write that to stdout; otherwise no-op. The caller
 *                     typically writes to a file directly.
 *   - error         → plain stderr line `<ErrorName>: <message>\n`, matching
 *                     v2.0.3's error format so CI pipelines don't regress.
 *
 * Used when:
 *   - `--silent` is set
 *   - `!isInteractive()` AND `--json` NOT set AND `--raw` NOT set
 */

import type { BlazeDocsError } from "../../errors.js";
import { redactApiKeys } from "../../errors.js";
import type { Renderer, ResultMeta } from "./types.js";

export interface SilentRendererOpts {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export class SilentRenderer implements Renderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;

  constructor(opts: SilentRendererOpts = {}) {
    this.stdout = opts.stdout ?? process.stdout;
    this.stderr = opts.stderr ?? process.stderr;
  }

  progress(_msg: string): void {
    /* silent */
  }

  success(payload: unknown, _meta?: ResultMeta): void {
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      const hasWrittenTo = typeof obj.written_to === "string";

      // Convert payload: markdown to stdout unless a file was written.
      const md = obj.markdown;
      if (typeof md === "string") {
        if (!hasWrittenTo) {
          this.stdout.write(md);
          if (!md.endsWith("\n")) this.stdout.write("\n");
        }
        return;
      }

      // Whoami payload: `email (tier plan, R/L pages remaining)` or tier fallback.
      if (
        "email" in obj &&
        typeof obj.tier === "string" &&
        typeof obj.pages_used === "number" &&
        typeof obj.pages_limit === "number" &&
        typeof obj.pages_remaining === "number"
      ) {
        const email = obj.email;
        if (typeof email === "string") {
          this.stdout.write(
            `${email} (${obj.tier} plan, ${obj.pages_remaining}/${obj.pages_limit} pages remaining)\n`,
          );
        } else {
          this.stdout.write(
            `${obj.tier} plan — ${obj.pages_used}/${obj.pages_limit} pages used, ${obj.pages_remaining} remaining\n`,
          );
        }
        return;
      }

      // Usage payload: v2.0.3-parity 4-line key/value dump.
      if (
        typeof obj.pages_used === "number" &&
        typeof obj.pages_limit === "number" &&
        typeof obj.pages_remaining === "number" &&
        typeof obj.tier === "string"
      ) {
        this.stdout.write(
          `Pages used:      ${obj.pages_used}\nPages limit:     ${obj.pages_limit}\nPages remaining: ${obj.pages_remaining}\nTier:            ${obj.tier}\n`,
        );
        return;
      }

      // Generic payload with a human-readable message (logout, login).
      if (typeof obj.message === "string") {
        this.stdout.write(`${obj.message}\n`);
        return;
      }
    }
  }

  error(err: BlazeDocsError): void {
    const msg = redactApiKeys(err.message);
    this.stderr.write(`${msg}\n`);
    const anyErr = err as unknown as { upgradeUrl?: string };
    if (anyErr.upgradeUrl) {
      this.stderr.write(`Upgrade: ${anyErr.upgradeUrl}\n`);
    }
  }

  note(_msg: string): void {
    /* silent */
  }

  async close(): Promise<void> {
    /* no-op */
  }
}
