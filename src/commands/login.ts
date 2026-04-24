import * as readline from "node:readline";
import * as os from "node:os";
import { saveConfig, loadConfig, configPath } from "../config.js";
import { validateApiKey, normalizeUsage } from "../api.js";
import { readStdinAll } from "../stdin.js";
import { AuthError, InvalidArgsError } from "../errors.js";
import type { Renderer } from "../ui/renderers/types.js";

export interface LoginOptions {
  apiKeyStdin?: boolean;
}

/**
 * Masked readline prompt. Kept inline for v3.0-beta.1; Phase 7 replaces this
 * with `@clack/prompts.password()` when the TTY wizard ships.
 */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      reject(
        new InvalidArgsError(
          "No TTY for interactive prompt.",
          "Use --api-key-stdin or BLAZEDOCS_API_KEY for automation.",
        ),
      );
      return;
    }

    stdout.write(question);

    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    const originalWrite = (stdout as unknown as { write: (chunk: string) => boolean }).write.bind(stdout);
    let muted = true;
    (stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
      if (muted && typeof chunk === "string" && chunk !== question) {
        return originalWrite("");
      }
      return originalWrite(chunk);
    };

    rl.question("", (answer) => {
      muted = false;
      (stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite;
      stdout.write("\n");
      rl.close();
      resolve(answer);
    });

    rl.on("error", (e) => {
      muted = false;
      (stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite;
      reject(e);
    });
  });
}

export async function loginCommand(opts: LoginOptions, renderer: Renderer): Promise<void> {
  let apiKey: string;

  if (opts.apiKeyStdin) {
    apiKey = (await readStdinAll()).trim();
    if (!apiKey) {
      throw new InvalidArgsError("No API key received on stdin.");
    }
  } else {
    apiKey = (await promptSecret("BlazeDocs API key: ")).trim();
    if (!apiKey) {
      throw new InvalidArgsError("No API key entered.");
    }
  }

  let snapshot;
  try {
    snapshot = await validateApiKey(apiKey);
  } catch (e) {
    if (e instanceof AuthError) {
      throw new AuthError(
        "Key rejected by the API. Check the value and try again.",
      );
    }
    throw e;
  }

  // Merge with existing config so we don't clobber any non-apiKey fields.
  const existing = loadConfig();
  saveConfig({ ...existing, apiKey, installedAt: existing.installedAt ?? new Date().toISOString() });

  const { tier, pagesUsed, pagesLimit, pagesRemaining } = normalizeUsage(snapshot);
  const email = (snapshot.email as string | undefined) ?? null;

  renderer.success({
    ok: true,
    email,
    tier,
    pages_used: pagesUsed,
    pages_limit: pagesLimit,
    pages_remaining: pagesRemaining,
    message: `Logged in. Key stored at ${shortPath(configPath())} (mode 0600).`,
  });
}

function shortPath(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) return "~" + p.slice(home.length).replace(/\\/g, "/");
  return p;
}
