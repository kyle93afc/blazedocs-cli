import * as os from "node:os";
import { saveConfig, loadConfig, configPath } from "../config.js";
import { validateApiKey, normalizeUsage } from "../api.js";
import { readStdinAll } from "../stdin.js";
import { AuthError, InvalidArgsError } from "../errors.js";
import type { Renderer } from "../ui/renderers/types.js";

export interface LoginOptions {
  apiKeyStdin?: boolean;
}

export async function loginCommand(opts: LoginOptions, renderer: Renderer): Promise<void> {
  let apiKey: string;

  if (opts.apiKeyStdin) {
    apiKey = (await readStdinAll()).trim();
    if (!apiKey) {
      throw new InvalidArgsError("No API key received on stdin.");
    }
  } else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new InvalidArgsError(
        "No TTY for interactive prompt.",
        "Use --api-key-stdin or BLAZEDOCS_API_KEY for automation.",
      );
    }
    const { promptApiKey } = await import("../ui/prompts.js");
    apiKey = await promptApiKey();
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
