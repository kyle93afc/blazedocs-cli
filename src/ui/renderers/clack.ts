/**
 * Clack Renderer: TTY human-facing mode.
 *
 * v3.0-beta.1 ships a minimal version: colored lines on stderr for progress,
 * a rendered boxed success line on stderr, a boxed error on stderr. The
 * banner, first-run wizard, boxed quota display, and @clack/prompts spinner
 * integration land in Phase 7.
 *
 * Rationale for the minimal shape: every renderer needs to ship before
 * bin/blazedocs.ts can dispatch to them. Phase 7 then upgrades clack.ts in
 * place to use @clack/prompts spinner, box(), note(), etc. The interface
 * (Renderer) stays stable so commands never re-migrate.
 */

import type { BlazeDocsError } from "../../errors.js";
import { redactApiKeys } from "../../errors.js";
import { c } from "../colors.js";
import { quotaBar } from "../quota-bar.js";
import type { Renderer, ResultMeta, UpgradeInfo } from "./types.js";
import { safeWrite } from "./safe-write.js";

export interface ClackRendererOpts {
  upgradeCheck?: Promise<UpgradeInfo | null>;
  upgradeTimeoutMs?: number;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export class ClackRenderer implements Renderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly upgradeCheck?: Promise<UpgradeInfo | null>;
  private readonly upgradeTimeoutMs: number;
  private closed = false;

  constructor(opts: ClackRendererOpts = {}) {
    this.stdout = opts.stdout ?? process.stdout;
    this.stderr = opts.stderr ?? process.stderr;
    this.upgradeCheck = opts.upgradeCheck;
    this.upgradeTimeoutMs = opts.upgradeTimeoutMs ?? 500;
  }

  progress(msg: string): void {
    // Phase 7 replaces with @clack/prompts.spinner(). For now, single-line update.
    safeWrite(this.stderr,`${c.muted("○")} ${msg}\n`);
  }

  success(payload: unknown, _meta?: ResultMeta): void {
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;

      // ConvertResult shape detection (has markdown + file_name + page_count).
      if (
        typeof obj.markdown === "string" &&
        typeof obj.file_name === "string" &&
        typeof obj.page_count === "number"
      ) {
        const pages = obj.page_count;
        const remaining =
          (obj.usage as { pages_remaining?: number } | undefined)?.pages_remaining;
        const writtenTo = typeof obj.written_to === "string" ? obj.written_to : undefined;

        if (writtenTo) {
          // File was written to disk. Emit a 1-line summary.
          const quotaHint = remaining != null ? ` · ${remaining} remaining this month` : "";
          safeWrite(this.stderr,
            `${c.success("✓")} Wrote ${c.bold(writtenTo)} (${pages} pages${quotaHint})\n`,
          );
        } else {
          // No --output. Stream markdown to stdout (v2.0.3 parity), summary on stderr.
          this.stdout.write(obj.markdown as string);
          if (!(obj.markdown as string).endsWith("\n")) this.stdout.write("\n");
          const quotaHint = remaining != null ? ` · ${remaining} remaining this month` : "";
          safeWrite(this.stderr,
            `${c.success("✓")} ${c.bold(String(obj.file_name))} (${pages} pages${quotaHint})\n`,
          );
        }
        return;
      }

      if (
        typeof obj.pages_used === "number" &&
        typeof obj.pages_limit === "number" &&
        typeof obj.pages_remaining === "number"
      ) {
        const tier = typeof obj.tier === "string" ? obj.tier : "unknown";
        const email = typeof obj.email === "string" ? obj.email : undefined;
        if (email) safeWrite(this.stderr,`${c.success("✓")} Signed in as ${c.bold(email)}\n`);
        safeWrite(this.stderr,`${c.bold(tier)} plan · ${obj.pages_used}/${obj.pages_limit} pages used\n`);
        safeWrite(this.stderr,`${quotaBar(obj.pages_used, obj.pages_limit)}\n`);
        safeWrite(this.stderr,`${obj.pages_remaining} pages remaining this month\n`);
        return;
      }

      // Generic shape with `message`.
      if (typeof obj.message === "string") {
        safeWrite(this.stderr,`${c.success("✓")} ${obj.message}\n`);
        return;
      }
    }
    safeWrite(this.stderr,`${c.success("✓")} ${String(payload)}\n`);
  }

  error(err: BlazeDocsError): void {
    const msg = redactApiKeys(err.message);
    safeWrite(this.stderr,`${c.error("✗")} ${c.bold(err.code)}  ${msg}\n`);
    if (err.hint) {
      safeWrite(this.stderr,`  ${c.accent("→")} ${redactApiKeys(err.hint)}\n`);
    }
    const anyErr = err as unknown as { upgradeUrl?: string };
    if (anyErr.upgradeUrl) {
      safeWrite(this.stderr,`  ${c.accent("→")} Upgrade at ${anyErr.upgradeUrl}\n`);
    }
    const apiErr = err as unknown as { apiResponse?: string };
    if (typeof apiErr.apiResponse === "string") {
      safeWrite(this.stderr,`  ${c.muted(redactApiKeys(apiErr.apiResponse))}\n`);
    }
  }

  note(msg: string): void {
    safeWrite(this.stderr,`${c.muted("◈")} ${c.muted(msg)}\n`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.upgradeCheck) return;

    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timerHandle = setTimeout(() => resolve(null), this.upgradeTimeoutMs);
      timerHandle.unref?.();
    });
    try {
      const info = await Promise.race([this.upgradeCheck, timeout]);
      if (info && info.available) {
        safeWrite(this.stderr,
          `\n${c.warn("▲")} Update available: ${c.bold(info.latest ?? "?")} (current: ${info.current})\n`,
        );
        if (info.install_cmd) {
          safeWrite(this.stderr,`  ${c.accent("→")} ${c.bold(info.install_cmd)}\n`);
        }
      }
    } catch {
      /* silent */
    } finally {
      if (timerHandle) clearTimeout(timerHandle);
    }
  }
}
