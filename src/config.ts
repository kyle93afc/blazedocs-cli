import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface BlazeDocsConfig {
  apiKey?: string;
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
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") {
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
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
