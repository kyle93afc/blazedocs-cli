/**
 * Adversarial regression: `blazedocs init` MUST fail with unknown-command.
 * `init` was intentionally killed in v3.0 per the CEO review. Prevents
 * accidental resurrection in a future refactor.
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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], {
      env: { ...process.env, BLAZEDOCS_SKIP_UPDATE_CHECK: "1" },
      encoding: "utf8",
      timeout: 5000,
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

describe("`init` subcommand is killed (per v3.0 CEO outside-voice review)", () => {
  beforeAll(() => {
    if (!fs.existsSync(BIN)) {
      throw new Error(`Binary not built at ${BIN}. Run \`npm run build\` first.`);
    }
  });

  it("rejects `blazedocs init` as an unknown command", async () => {
    const res = await runCli(["init"]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/unknown command/i);
  });

  it("`--help` output does NOT list `init` as a subcommand", async () => {
    const res = await runCli(["--help"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/convert/);
    expect(res.stdout).not.toMatch(/\binit\b/);
  });
});
