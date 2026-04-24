/**
 * Raw Renderer: pipeline-friendly mode for `--raw`.
 *
 * Pattern borrowed from microsoft/playwright-cli.
 *   - progress/note → swallowed (pure payload; nothing extra)
 *   - success       → payload string only (for convert: markdown, no
 *                     trailing newline added). Caller is responsible for
 *                     whitespace. No envelope, no headers, no decoration.
 *   - error         → single line `[CODE] message\n` on stderr. Agents can
 *                     regex this with `/^\[([A-Z_]+)\] /` deterministically.
 *
 * Under --raw: upgrade check is SKIPPED entirely (no meta channel to emit
 * into). See upgrade-check.ts for the skip logic.
 */

import type { BlazeDocsError } from "../../errors.js";
import { redactApiKeys } from "../../errors.js";
import type { Renderer, ResultMeta } from "./types.js";

export interface RawRendererOpts {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export class RawRenderer implements Renderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;

  constructor(opts: RawRendererOpts = {}) {
    this.stdout = opts.stdout ?? process.stdout;
    this.stderr = opts.stderr ?? process.stderr;
  }

  progress(_msg: string): void {
    /* silent */
  }

  success(payload: unknown, _meta?: ResultMeta): void {
    // For convert: emit just the markdown.
    // For other commands that might use --raw in the future (usage, whoami),
    // emit the primary string field if present, otherwise a terse form.
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      if (typeof obj.markdown === "string") {
        this.stdout.write(obj.markdown);
        return;
      }
      if (typeof obj.value === "string") {
        this.stdout.write(obj.value + "\n");
        return;
      }
    }
    if (typeof payload === "string") {
      this.stdout.write(payload);
      return;
    }
    // Last resort: whatever it is, serialize compactly.
    this.stdout.write(String(payload));
  }

  error(err: BlazeDocsError): void {
    this.stderr.write(`[${err.code}] ${redactApiKeys(err.message)}\n`);
  }

  note(_msg: string): void {
    /* silent */
  }

  async close(): Promise<void> {
    /* no-op */
  }
}
