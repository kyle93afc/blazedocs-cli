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
    // Raw mode: the single most pipe-useful field for each payload shape.
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;

      // Convert: markdown only, no newline added.
      if (typeof obj.markdown === "string") {
        this.stdout.write(obj.markdown);
        return;
      }

      // Whoami: email if present, otherwise tier.
      if ("email" in obj && typeof obj.tier === "string") {
        const email = obj.email;
        this.stdout.write(`${typeof email === "string" ? email : obj.tier}\n`);
        return;
      }

      // Usage: `used/limit` (pipe-friendly arithmetic check).
      if (typeof obj.pages_used === "number" && typeof obj.pages_limit === "number") {
        this.stdout.write(`${obj.pages_used}/${obj.pages_limit}\n`);
        return;
      }

      // Skills get: dump markdown content to stdout (redirection-friendly).
      if (typeof obj.content === "string" && typeof obj.name === "string") {
        this.stdout.write(obj.content);
        return;
      }

      // Doctor: single-word overall status for scripting.
      if (Array.isArray(obj.checks) && typeof obj.overall === "string") {
        this.stdout.write(`${obj.overall}\n`);
        return;
      }

      // Generic: message string.
      if (typeof obj.message === "string") {
        this.stdout.write(`${obj.message}\n`);
        return;
      }

      // Boolean ok shape.
      if (typeof obj.ok === "boolean") {
        this.stdout.write(`${obj.ok ? "ok" : "fail"}\n`);
        return;
      }
    }
    if (typeof payload === "string") {
      this.stdout.write(payload);
      return;
    }
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
