/**
 * Adversarial regression: camelCase flags must be rejected. Every flag in
 * the CLI is kebab-case per design doc A6. A future contributor adding
 * `--apiKeyStdin` or `--noJson` would silently break the kebab convention
 * agents depend on for stable flag names.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";

const execFileAsync = promisify(execFile);
const BIN = path.join(process.cwd(), "dist", "bin", "blazedocs.js");

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], {
      env: { ...process.env, BLAZEDOCS_SKIP_UPDATE_CHECK: "1", ...env },
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

describe("kebab-case flag enforcement", () => {
  beforeAll(() => {
    if (!fs.existsSync(BIN)) {
      throw new Error(`Binary not built at ${BIN}. Run \`npm run build\` first.`);
    }
  });

  it("rejects --apiKeyStdin (camelCase) — only --api-key-stdin accepted", async () => {
    const res = await runCli(["login", "--apiKeyStdin"]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/unknown option/i);
  });

  it("rejects --noJson (camelCase)", async () => {
    const res = await runCli(["--noJson", "whoami"]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/unknown option/i);
  });

  it("rejects --apiKey= (the old v1 form, security regression for v2.0.0)", async () => {
    const res = await runCli(["login", "--apiKey=bd_live_xyz"]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/unknown option/i);
  });

  it("accepts --api-key-stdin (kebab-case, documented form)", async () => {
    // Piping empty stdin causes the CLI to reject, but it's parsed as a valid
    // flag first — so we see the InvalidArgs error, not "unknown option".
    const child = execFile(process.execPath, [BIN, "--json", "login", "--api-key-stdin"], {
      env: { ...process.env, BLAZEDOCS_SKIP_UPDATE_CHECK: "1" },
      encoding: "utf8",
      timeout: 5000,
    });
    // Close stdin immediately.
    child.stdin?.end();

    const result = await new Promise<{ stderr: string; exitCode: number }>((resolve) => {
      let stderr = "";
      child.stderr?.on("data", (c) => {
        stderr += c;
      });
      child.on("close", (code) => resolve({ stderr, exitCode: code ?? 0 }));
    });

    expect(result.stderr).not.toMatch(/unknown option/i);
    // The flag was parsed; the command then rejected empty stdin.
    expect(result.exitCode).not.toBe(0);
  });
});
