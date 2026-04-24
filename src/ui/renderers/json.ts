/**
 * JSON Renderer: agent-primary output mode.
 *
 * Stream contract:
 *   - Success payloads → stdout only, one `{"type":"result","data":{...}}`
 *     line per item. Multi-input commands emit JSONL.
 *   - Fatal errors     → stderr only, one `{"error":{...}}` line.
 *   - When upgrade check resolves before close(), a terminal
 *     `{"type":"meta","upgrade":{...}}` line is emitted on stdout.
 *   - Under --json: stderr NEVER carries ANSI, progress text, or banners.
 *     Under --json: stdout NEVER carries anything but structured JSON lines.
 *
 * `progress` and `note` are suppressed by default (they have no place in a
 * machine-readable stream). Set BLAZEDOCS_JSON_VERBOSE=1 to emit
 * `{"type":"progress",...}` and `{"type":"note",...}` lines for agents that
 * want trace visibility.
 */

import type { BlazeDocsError } from "../../errors.js";
import { exitCodeFor, redactApiKeys } from "../../errors.js";
import type { Renderer, ResultMeta, UpgradeInfo } from "./types.js";
import { safeWrite } from "./safe-write.js";

export interface JsonRendererOpts {
  /** Promise resolved when the upgrade-check completes (up to 500ms). */
  upgradeCheck?: Promise<UpgradeInfo | null>;
  /** Max time to wait on the upgrade check at close() time. Default 500ms. */
  upgradeTimeoutMs?: number;
  /** Test seam. */
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export class JsonRenderer implements Renderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly upgradeCheck?: Promise<UpgradeInfo | null>;
  private readonly upgradeTimeoutMs: number;
  private readonly verbose: boolean;
  private closed = false;

  constructor(opts: JsonRendererOpts = {}) {
    this.stdout = opts.stdout ?? process.stdout;
    this.stderr = opts.stderr ?? process.stderr;
    this.upgradeCheck = opts.upgradeCheck;
    this.upgradeTimeoutMs = opts.upgradeTimeoutMs ?? 500;
    this.verbose = process.env.BLAZEDOCS_JSON_VERBOSE === "1";
  }

  private writeLine(stream: NodeJS.WritableStream, obj: unknown): void {
    safeWrite(stream, JSON.stringify(obj) + "\n");
  }

  progress(msg: string): void {
    if (!this.verbose) return;
    this.writeLine(this.stdout, { type: "progress", message: msg });
  }

  success(payload: unknown, _meta?: ResultMeta): void {
    // Note: per the JSONL type-discriminator decision (design doc A1),
    // `meta.upgrade` is NOT attached to individual result lines. It's emitted
    // as a separate terminal {"type":"meta"} line at close() time.
    this.writeLine(this.stdout, { type: "result", data: payload });
  }

  error(err: BlazeDocsError): void {
    const body: {
      code: string;
      message: string;
      hint?: string;
      exit_code: number;
      upgrade_url?: string;
      api_status?: number;
      api_code?: string;
      api_response?: string;
    } = {
      code: err.code,
      message: redactApiKeys(err.message),
      exit_code: exitCodeFor(err),
    };
    if (err.hint) body.hint = redactApiKeys(err.hint);
    const anyErr = err as unknown as { upgradeUrl?: string };
    if (typeof anyErr.upgradeUrl === "string") body.upgrade_url = anyErr.upgradeUrl;
    const apiErr = err as unknown as { status?: number; apiCode?: string; apiResponse?: string };
    if (typeof apiErr.status === "number") body.api_status = apiErr.status;
    if (typeof apiErr.apiCode === "string") body.api_code = apiErr.apiCode;
    if (typeof apiErr.apiResponse === "string") body.api_response = redactApiKeys(apiErr.apiResponse);
    this.writeLine(this.stderr, { error: body });
  }

  note(msg: string): void {
    if (!this.verbose) return;
    this.writeLine(this.stdout, { type: "note", message: msg });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.upgradeCheck) return;

    // Capture and clear the timer handle so the event loop isn't pinned when
    // upgradeCheck wins the race. unref() is belt-and-braces: even if we
    // forget to clearTimeout, the timer won't keep the process alive.
    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timerHandle = setTimeout(() => resolve(null), this.upgradeTimeoutMs);
      timerHandle.unref?.();
    });
    try {
      const info = await Promise.race([this.upgradeCheck, timeout]);
      if (info && info.available) {
        this.writeLine(this.stdout, { type: "meta", upgrade: info });
      }
    } catch {
      /* check errored silently */
    } finally {
      if (timerHandle) clearTimeout(timerHandle);
    }
  }
}
