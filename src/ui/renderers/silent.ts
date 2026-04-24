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
    // Back-compat: convert command (v2.0.3 shape) passed full markdown string
    // via result.markdown. Silent renderer writes that to stdout to preserve
    // `blazedocs convert foo.pdf | cat` pipe semantics.
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      const md = obj.markdown;
      if (typeof md === "string") {
        this.stdout.write(md);
        if (!md.endsWith("\n")) this.stdout.write("\n");
        return;
      }
    }
    // Otherwise silent renderer is a no-op on success. Caller writes to file.
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
