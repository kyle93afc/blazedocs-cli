import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface BlazeDocsConfig {
  apiKey?: string;
  /** ISO-8601 timestamp of first login. Written once by login, used by v3.1's
   *  update-check cadence logic. Read-modify-write preserves unknown fields. */
  installedAt?: string;
}

export function configDir(): string {
  return path.join(os.homedir(), ".blazedocs");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): BlazeDocsConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveConfig(config: BlazeDocsConfig): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else if (process.platform !== "win32") {
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  }
  const file = configPath();
  // Atomic write: tmpfile → chmod → rename. Prevents two concurrent `login`
  // invocations (or a login-in-flight during a read) from tearing the file.
  // Pattern matches src/ui/upgrade-check.ts:writeCache for consistency.
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
    if (process.platform !== "win32") {
      try { fs.chmodSync(tmp, 0o600); } catch { /* best effort */ }
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    // If rename failed, clean up the orphaned tmp file so ~/.blazedocs/ doesn't
    // accumulate cruft across failed writes.
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

export function clearConfig(): void {
  const file = configPath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * Resolve the API key. Precedence:
 *   1. BLAZEDOCS_API_KEY env var
 *   2. ~/.blazedocs/config.json apiKey field
 * Returns undefined if neither is set.
 */
export function resolveApiKey(): string | undefined {
  if (process.env.BLAZEDOCS_API_KEY) return process.env.BLAZEDOCS_API_KEY;
  const cfg = loadConfig();
  return cfg.apiKey;
}
