import * as fs from "node:fs";
import * as path from "node:path";
import { resolveApiKey } from "../config.js";
import { convertPdf, type ConvertResult } from "../api.js";
import { AuthError, FileNotFoundError, InvalidArgsError } from "../errors.js";
import type { Renderer } from "../ui/renderers/types.js";

export interface ConvertCmdOptions {
  output?: string;
}

function isDirectoryTarget(target: string): boolean {
  if (target.endsWith("/") || target.endsWith("\\")) return true;
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function deriveMdName(input: string): string {
  let base: string;
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      base = path.basename(new URL(input).pathname) || "download.pdf";
    } catch {
      base = "download.pdf";
    }
  } else {
    base = path.basename(input);
  }
  if (base.toLowerCase().endsWith(".pdf")) base = base.slice(0, -4);
  return `${base}.md`;
}

/**
 * Convert PDFs to Markdown.
 *
 * Output contract (per renderer):
 *   - JsonRenderer:   emits `{"type":"result","data":<ConvertResult>}` per file on stdout.
 *                     Multi-file input → JSONL (one object per line).
 *   - RawRenderer:    emits the markdown string only, no envelope, no newline added.
 *   - SilentRenderer: writes markdown to stdout only when no `--output` file is set.
 *                     With `--output`, writes the file and emits nothing to stdout
 *                     (matches v2.0.3 silent behavior).
 *   - ClackRenderer:  progress line per file, success box at end with quota remaining.
 *
 * The `--output` flag routes the MARKDOWN PAYLOAD to a file on disk REGARDLESS
 * of renderer. Under --json, the JSON envelope still goes to stdout AND the
 * markdown is also written to the file. Agents can use both: parse the JSON
 * envelope from stdout, and reference the file on disk.
 */
export async function convertCommand(
  inputs: string[],
  opts: ConvertCmdOptions,
  renderer: Renderer,
): Promise<void> {
  const key = resolveApiKey();
  if (!key) {
    throw new AuthError();
  }

  if (inputs.length === 0) {
    throw new InvalidArgsError(
      "No input files specified.",
      "Example: blazedocs convert file.pdf",
    );
  }

  // Validate local files up-front (regression: v2.0.1 fix — don't print
  // "Converting..." before discovering a file is missing).
  for (const input of inputs) {
    if (input.startsWith("http://") || input.startsWith("https://")) continue;
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      throw new FileNotFoundError(resolved);
    }
  }

  const hasOutput = Boolean(opts.output);
  const outputIsDir = hasOutput && isDirectoryTarget(opts.output!);
  const multipleInputs = inputs.length > 1;

  if (multipleInputs && hasOutput && !outputIsDir) {
    throw new InvalidArgsError(
      "Multiple inputs require --output to be a directory.",
      "Pass a trailing slash, e.g. --output results/.",
    );
  }

  if (opts.output && outputIsDir) {
    fs.mkdirSync(opts.output, { recursive: true });
  }

  for (const input of inputs) {
    renderer.progress(`Converting ${input}...`);
    const result: ConvertResult = await convertPdf(input, { apiKey: key });

    // Write to disk if --output was specified.
    let writtenPath: string | undefined;
    if (opts.output) {
      const target = outputIsDir ? path.join(opts.output, deriveMdName(input)) : opts.output;
      const payload = result.markdown.endsWith("\n") ? result.markdown : result.markdown + "\n";
      fs.writeFileSync(target, payload);
      writtenPath = target;
    }

    // Build the payload the renderer receives. For convert, this is the full
    // ConvertResult plus an optional `written_to` field when --output wrote a file.
    const payload = writtenPath ? { ...result, written_to: writtenPath } : result;
    renderer.success(payload);
  }
}
