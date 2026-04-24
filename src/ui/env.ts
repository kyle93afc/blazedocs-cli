/**
 * Pure environment predicates used by bin/blazedocs.ts and the renderers to
 * decide what the output should look like. No side effects, no imports beyond
 * `node:process`. Must stay importable from the hot path without paying for
 * any downstream UI module.
 *
 * Rule table: see design doc §"Banner and Color Rendering Rules".
 */

export interface FlagOpts {
  json?: boolean;
  raw?: boolean;
  silent?: boolean;
  yes?: boolean;
}

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const n = v.toLowerCase();
  return n !== "" && n !== "0" && n !== "false";
}

/** True when the process is running in an interactive terminal session. */
export function isInteractive(): boolean {
  if (process.env.BLAZEDOCS_INTERACTIVE === "1") return true;
  if (process.env.BLAZEDOCS_INTERACTIVE === "0") return false;
  if (truthy(process.env.CI)) return false;
  if (!process.stdout.isTTY) return false;
  if (!process.stdin.isTTY) return false;
  return true;
}

/** True when we can render ANSI color in the current environment. */
export function shouldShowColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

/** True when the terminal likely renders Unicode block-drawing characters. */
export function isUnicodeCapable(): boolean {
  if (process.env.BLAZEDOCS_ASCII_LOGO === "1") return false;
  if (process.env.TERM === "dumb") return false;
  if (process.platform !== "win32") return true;
  if (process.env.WT_SESSION) return true;
  if (process.env.TERM_PROGRAM === "vscode") return true;
  if (process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm") return true;
  // Default on Windows: assume Unicode. Legacy cmd.exe users opt out via
  // BLAZEDOCS_ASCII_LOGO=1. Mis-rendering shows as '?' boxes, not a crash.
  return true;
}

/**
 * Decide whether the big ANSI-block banner should render for this invocation.
 * Banner is for the first-impression surfaces ONLY: `blazedocs` with no args,
 * or `blazedocs login` on an interactive TTY path.
 */
export function shouldShowBanner(args: {
  opts: FlagOpts;
  command: "noargs" | "login" | "convert" | "usage" | "whoami" | "logout" | "doctor" | "skills" | "interactive";
}): boolean {
  if (!isInteractive()) return false;
  if (args.opts.silent || args.opts.json || args.opts.raw) return false;
  if (process.env.BLAZEDOCS_NO_BANNER) return false;
  return args.command === "noargs" || args.command === "login" || args.command === "interactive";
}

/** Terminal width, default 80 when undefined (non-TTY). */
export function terminalCols(): number {
  return process.stdout.columns ?? 80;
}
