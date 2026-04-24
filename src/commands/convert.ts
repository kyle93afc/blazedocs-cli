import * as fs from "node:fs";
import * as path from "node:path";
import { resolveApiKey } from "../config.js";
import { convertPdf, type ConvertResult } from "../api.js";
import { AuthError, BlazeDocsError, FileNotFoundError, InvalidArgsError, exitCodeFor } from "../errors.js";
import { isInteractive } from "../ui/env.js";
import type { Renderer } from "../ui/renderers/types.js";

export interface ConvertCmdOptions {
  output?: string;
  batch?: boolean;
  concurrency?: string | number;
  onError?: "abort" | "continue";
  summary?: string;
  idempotencyKey?: string;
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

function parseConcurrency(value: string | number | undefined): number {
  const parsed = Number(value ?? 1);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgsError("--concurrency must be a positive integer.");
  }
  return parsed;
}

function idempotencyKeyFor(input: string, index: number, total: number, base?: string): string | undefined {
  if (!base) return undefined;
  if (total === 1) return base;
  return `${base}:${index + 1}:${deriveMdName(input)}`;
}

function serializeError(error: unknown): { code: string; message: string; exit_code: number } {
  if (error instanceof BlazeDocsError) {
    return { code: error.code, message: error.message, exit_code: exitCodeFor(error) };
  }
  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : String(error),
    exit_code: 1,
  };
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
  if (inputs.length === 0) {
    if (!isInteractive()) {
      throw new InvalidArgsError(
        "No input files specified.",
        "Example: blazedocs convert file.pdf",
      );
    }
    const { promptPdfInput, promptOutput } = await import("../ui/prompts.js");
    const input = await promptPdfInput();
    inputs = [input];
    if (!opts.output) {
      opts = { ...opts, output: await promptOutput(input) };
    }
  }

  const key = resolveApiKey();
  if (!key) {
    throw new AuthError();
  }
  const apiKey = key;

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

  const batchMode = Boolean(opts.batch);
  const onError = opts.onError ?? "abort";
  const concurrency = parseConcurrency(opts.concurrency);
  if (opts.onError && !["abort", "continue"].includes(opts.onError)) {
    throw new InvalidArgsError("--on-error must be either abort or continue.");
  }
  if (!batchMode && opts.summary) {
    throw new InvalidArgsError("--summary is only valid with --batch.");
  }
  if (!batchMode && opts.concurrency && concurrency !== 1) {
    throw new InvalidArgsError("--concurrency is only valid with --batch.");
  }

  const summary = {
    total: inputs.length,
    succeeded: 0,
    failed: 0,
    results: [] as Array<
      | { input: string; status: "succeeded"; output?: string; pages?: number; tokens?: number }
      | { input: string; status: "failed"; error: { code: string; message: string; exit_code: number } }
    >,
  };

  async function convertOne(input: string, index: number): Promise<void> {
    renderer.progress(`Converting ${input}...`);
    const result: ConvertResult = await convertPdf(input, {
      apiKey,
      idempotencyKey: idempotencyKeyFor(input, index, inputs.length, opts.idempotencyKey),
    });

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
    summary.succeeded += 1;
    summary.results[index] = {
      input,
      status: "succeeded",
      output: writtenPath,
      pages: result.page_count,
      tokens: result.token_count,
    };
  }

  if (!batchMode) {
    for (let index = 0; index < inputs.length; index += 1) {
      await convertOne(inputs[index], index);
    }
    return;
  }

  let nextIndex = 0;
  let aborted = false;
  async function worker(): Promise<void> {
    while (!aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= inputs.length) return;
      try {
        await convertOne(inputs[index], index);
      } catch (error) {
        summary.failed += 1;
        summary.results[index] = {
          input: inputs[index],
          status: "failed",
          error: serializeError(error),
        };
        if (onError === "continue") {
          if (error instanceof BlazeDocsError) renderer.error(error);
          continue;
        }
        aborted = true;
        throw error;
      }
    }
  }

  let batchError: unknown;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  } catch (error) {
    batchError = error;
  }

  const summaryPath = opts.summary ?? "blazedocs-summary.json";
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  if (batchError) {
    throw batchError;
  }
  if (summary.failed > 0 && onError !== "continue") {
    const firstFailure = summary.results.find((result) => result.status === "failed");
    if (firstFailure?.status === "failed") {
      throw new InvalidArgsError(firstFailure.error.message);
    }
  }
}
