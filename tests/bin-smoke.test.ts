import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

const BIN = path.join(process.cwd(), "dist", "bin", "blazedocs.js");

describe("binary smoke tests", () => {
  beforeAll(() => {
    if (!fs.existsSync(BIN)) {
      throw new Error(`Binary not built at ${BIN}. Run \`npm run build\` first.`);
    }
  });

  it("--version exits 0 and prints a semver", () => {
    const res = spawnSync(process.execPath, [BIN, "--version"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--help exits 0 and lists the convert command", () => {
    const res = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("convert");
  });

  it("rejects the old --api-key=VALUE flag (security regression)", () => {
    // Any subcommand would do — login is the one that used to accept the flag.
    const res = spawnSync(
      process.execPath,
      [BIN, "login", "--api-key=bd_live_shouldfail"],
      { encoding: "utf8" },
    );
    // commander exits 1 on unknown options and prints "unknown option" to stderr.
    expect(res.status).not.toBe(0);
    expect(res.stderr + res.stdout).toMatch(/unknown option/i);
  });

  it("prints the auth hint exactly once on AuthError (regression for v2.0.0 duplicate hint)", () => {
    const res = spawnSync(
      process.execPath,
      [BIN, "whoami"],
      { encoding: "utf8", env: { ...process.env, BLAZEDOCS_API_KEY: "" } },
    );
    expect(res.status).toBe(3);
    const hintCount = (res.stderr.match(/blazedocs login/g) || []).length;
    expect(hintCount).toBe(1);
  });

  it("fails fast on missing local file without printing 'Converting...' (regression for v2.0.0)", () => {
    const res = spawnSync(
      process.execPath,
      [BIN, "convert", "/tmp/definitely-does-not-exist-xyz.pdf"],
      { encoding: "utf8", env: { ...process.env, BLAZEDOCS_API_KEY: "bd_live_dummy" } },
    );
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/File not found/);
    expect(res.stderr).not.toMatch(/Converting/);
  });
});
