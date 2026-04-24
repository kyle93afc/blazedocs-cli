/**
 * Single decision point for which Renderer a command gets.
 * Commands never look at flags themselves; they receive a Renderer and call
 * its .success/.error/.progress/.note methods. bin/blazedocs.ts constructs
 * the renderer once per invocation and passes it down.
 *
 * Precedence (see design doc A1 + A2):
 *   --json wins on stdout format
 *   --raw  wins on decoration (no envelope)
 *   --silent wins on TTY chrome (no banner, no spinner)
 *   TTY default: clack
 *   Non-TTY without any flag: silent (pipe-safe v2.0.3 parity)
 */

import type { FlagOpts } from "./env.js";
import { isInteractive } from "./env.js";
import type { Renderer, UpgradeInfo } from "./renderers/types.js";
import { JsonRenderer } from "./renderers/json.js";
import { SilentRenderer } from "./renderers/silent.js";
import { RawRenderer } from "./renderers/raw.js";
import { ClackRenderer } from "./renderers/clack.js";

export interface MakeRendererArgs {
  opts: FlagOpts;
  upgradeCheck?: Promise<UpgradeInfo | null>;
}

export type RendererKind = "json" | "raw" | "silent" | "clack";

export function pickRenderer(opts: FlagOpts): RendererKind {
  if (opts.json) return "json";
  if (opts.raw) return "raw";
  if (opts.silent) return "silent";
  if (isInteractive()) return "clack";
  return "silent";
}

export function makeRenderer(args: MakeRendererArgs): Renderer {
  const kind = pickRenderer(args.opts);
  switch (kind) {
    case "json":
      return new JsonRenderer({ upgradeCheck: args.upgradeCheck });
    case "raw":
      // Raw skips upgrade-check intentionally — no meta channel to emit into.
      return new RawRenderer();
    case "silent":
      return new SilentRenderer();
    case "clack":
      return new ClackRenderer({ upgradeCheck: args.upgradeCheck });
  }
}
