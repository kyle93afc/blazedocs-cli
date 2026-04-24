/**
 * The v3.0 output abstraction. Every command renders through a Renderer
 * instead of checking flags inline. Keeps DRY, makes mode-specific behavior
 * unit-testable with fake streams, and turns every new output mode into a new
 * file rather than a multi-place refactor.
 *
 * Decision point: bin/blazedocs.ts picks the concrete Renderer based on
 * global flags + env.isInteractive() and passes it to the command. Commands
 * never inspect `opts.json`/`opts.raw`/`opts.silent` themselves.
 */

import type { BlazeDocsError } from "../../errors.js";

export interface UpgradeInfo {
  available: boolean;
  current: string;
  latest?: string;
  install_cmd?: string;
}

export interface ResultMeta {
  upgrade?: UpgradeInfo;
}

export interface Renderer {
  /** Start or update a progress line. Spinner on TTY; suppressed under JSON/raw/silent by default. */
  progress(msg: string): void;
  /** Emit a successful payload. For multi-input commands, call `success` per item. */
  success(payload: unknown, meta?: ResultMeta): void;
  /** Emit a structured error. The Renderer picks the channel (stdout JSONL vs stderr box vs stderr code). */
  error(err: BlazeDocsError): void;
  /** A muted, secondary line. Suppressed under JSON/raw/silent by default. */
  note(msg: string): void;
  /** Terminate the renderer. Flush spinners, close clack sessions, resolve upgrade-check race. */
  close(): Promise<void>;
}
