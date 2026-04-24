/**
 * Drain stdin to a string. Used by `blazedocs login --api-key-stdin` so agents,
 * CI, and scripts can pipe the key without exposing it in argv. The only
 * non-interactive input path for v3.0+; everything else is flags or env vars.
 *
 * Renamed from src/prompt.ts in v3.0: after `promptSecret` was replaced by
 * `@clack/prompts.password()`, only stdin-draining remained in this file, and
 * the old name was misleading.
 */
export function readStdinAll(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}
