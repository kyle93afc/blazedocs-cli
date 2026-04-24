import * as fs from "fs";
import * as path from "path";
import { resolveApiKey } from "../config.js";
import { convertPdf } from "../api.js";
import { AuthError } from "../errors.js";

export interface ConvertCmdOptions {
  output?: string;
  json?: boolean;
  silent?: boolean;
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

export async function convertCommand(
  inputs: string[],
  opts: ConvertCmdOptions,
): Promise<void> {
  const key = resolveApiKey();
  if (!key) {
    throw new AuthError("Not authenticated. Run `blazedocs login` or set BLAZEDOCS_API_KEY.");
  }

  if (inputs.length === 0) {
    throw new Error("No input files specified. Example: blazedocs convert file.pdf");
  }

  for (const input of inputs) {
    if (input.startsWith("http://") || input.startsWith("https://")) continue;
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }
  }

  const hasOutput = Boolean(opts.output);
  const outputIsDir = hasOutput && isDirectoryTarget(opts.output!);
  const multipleInputs = inputs.length > 1;

  if (multipleInputs && hasOutput && !outputIsDir) {
    throw new Error("Multiple inputs require --output to be a directory (pass a trailing slash, e.g. --output results/).");
  }

  if (opts.output && outputIsDir) {
    fs.mkdirSync(opts.output, { recursive: true });
  }

  for (const input of inputs) {
    if (!opts.silent && !opts.json) {
      process.stderr.write(`Converting ${input}...\n`);
    }
    const result = await convertPdf(input, { apiKey: key });

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      continue;
    }

    if (!opts.output) {
      safeStdoutWrite(result.markdown);
      if (!result.markdown.endsWith("\n")) safeStdoutWrite("\n");
      continue;
    }

    let target: string;
    if (outputIsDir) {
      target = path.join(opts.output, deriveMdName(input));
    } else {
      target = opts.output;
    }
    const payload = result.markdown.endsWith("\n") ? result.markdown : result.markdown + "\n";
    fs.writeFileSync(target, payload);
    if (!opts.silent) {
      process.stderr.write(
        `Wrote ${target} (${result.page_count} pages, ${result.usage.pages_remaining} pages remaining)\n`,
      );
    }
  }
}

function safeStdoutWrite(data: string): void {
  try {
    process.stdout.write(data);
  } catch (e) {
    // Swallow EPIPE (|  head) silently.
    if ((e as NodeJS.ErrnoException).code !== "EPIPE") throw e;
  }
}
