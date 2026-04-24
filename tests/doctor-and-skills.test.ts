/**
 * E2E tests for `doctor` and `skills` commands.
 * Uses the same in-process HTTP mock pattern as convert-regression.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const execFileAsync = promisify(execFile);
const BIN = path.join(process.cwd(), "dist", "bin", "blazedocs.js");

let server: http.Server;
let serverUrl: string;
let nextResponse: { status: number; body: Record<string, unknown> };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("connection", "close");
      res.writeHead(nextResponse.status, { "content-type": "application/json" });
      res.end(JSON.stringify(nextResponse.body));
    });
  });
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "object" && addr) {
    serverUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  }
});

afterAll(async () => {
  if (typeof (server as unknown as { closeAllConnections?: () => void }).closeAllConnections === "function") {
    (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  nextResponse = {
    status: 200,
    body: {
      tier: "pro",
      email: "kyle@blazedocs.io",
      usage: { monthlyPages: 42 },
      limits: { pages: 100 },
    },
  };
});

function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bd-doctor-skills-"));
  return {
    ...process.env,
    BLAZEDOCS_API_KEY: "bd_live_testkey",
    BLAZEDOCS_API_URL: serverUrl,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    BLAZEDOCS_SKIP_UPDATE_CHECK: "1",
    ...overrides,
  };
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], {
      env,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
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

describe("skills", () => {
  it("skills list --json emits the skills array", async () => {
    const res = await runCli(["--json", "skills", "list"], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    expect(parsed.type).toBe("result");
    expect(parsed.data.skills).toContain("core");
    expect(parsed.data.count).toBeGreaterThanOrEqual(1);
  });

  it("skills get core --raw dumps the markdown manual to stdout", async () => {
    const res = await runCli(["--raw", "skills", "get", "core"], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/^---$/m);
    expect(res.stdout).toContain("name: blazedocs");
    expect(res.stdout).toContain("AUTH_REQUIRED");
    expect(res.stdout.length).toBeGreaterThan(2000);
  });

  it("skills get unknown exits 1 with SKILL_NOT_FOUND", async () => {
    const res = await runCli(["--json", "skills", "get", "nonexistent"], testEnv());
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toBe("");
    const err = JSON.parse(res.stderr.trim().split("\n")[0]);
    expect(err.error.code).toBe("SKILL_NOT_FOUND");
  });

  it("skills get core (default) works without explicit name arg", async () => {
    const res = await runCli(["--json", "skills", "get"], testEnv());
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    expect(parsed.data.name).toBe("core");
    expect(parsed.data.content).toContain("BlazeDocs");
  });

  it("skills install writes to the skill.sh-compatible default path", async () => {
    const env = testEnv();
    const home = env.HOME!;
    const res = await runCli(["--json", "skills", "install"], env);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    expect(parsed.data.ok).toBe(true);
    expect(parsed.data.path).toBe(path.join(home, ".agents", "skills", "blazedocs", "SKILL.md"));
    expect(fs.readFileSync(parsed.data.path, "utf8")).toContain("name: blazedocs");
  });

  it("skills install --target-dir writes under a custom skill root", async () => {
    const env = testEnv();
    const root = path.join(env.HOME!, "custom-skills");
    const res = await runCli(["--json", "skills", "install", "--target-dir", root], env);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    expect(parsed.data.path).toBe(path.join(root, "blazedocs", "SKILL.md"));
    expect(fs.existsSync(parsed.data.path)).toBe(true);
  });

  it("skills install --target-dir skips existing custom installs unless forced", async () => {
    const env = testEnv();
    const root = path.join(env.HOME!, "custom-skills");
    await runCli(["--json", "skills", "install", "--target-dir", root], env);
    const res = await runCli(["--json", "skills", "install", "--target-dir", root], env);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    expect(parsed.data.skipped).toBe(true);
  });
});

describe("doctor", () => {
  it("doctor --json returns a well-formed report", async () => {
    const res = await runCli(["--json", "doctor"], testEnv());
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    expect(parsed.type).toBe("result");
    expect(Array.isArray(parsed.data.checks)).toBe(true);
    expect(parsed.data.checks.length).toBeGreaterThan(0);
    expect(["pass", "warn", "fail"]).toContain(parsed.data.overall);
    for (const check of parsed.data.checks) {
      expect(typeof check.name).toBe("string");
      expect(["pass", "warn", "fail"]).toContain(check.status);
      expect(typeof check.detail).toBe("string");
    }
  });

  it("doctor reports Auth=fail when no API key is configured anywhere", async () => {
    const env = testEnv({ BLAZEDOCS_API_KEY: "" });
    const res = await runCli(["--json", "doctor"], env);
    expect(res.exitCode).toBe(0); // doctor itself succeeds even when checks fail
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    const auth = parsed.data.checks.find((c: { name: string }) => c.name === "Auth");
    expect(auth?.status).toBe("fail");
    expect(parsed.data.overall).toBe("fail");
  });

  it("doctor --raw emits single-word overall status for scripting", async () => {
    const res = await runCli(["--raw", "doctor"], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toMatch(/^(pass|warn|fail)$/);
  });

  it("doctor detects partial config (file exists, no apiKey)", async () => {
    // Codex outside-voice finding #4 regression test.
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bd-doctor-partial-"));
    const cfgDir = path.join(tmpHome, ".blazedocs");
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({ installedAt: "2026-01-01" }));

    const env = testEnv({ BLAZEDOCS_API_KEY: "", HOME: tmpHome, USERPROFILE: tmpHome });
    const res = await runCli(["--json", "doctor"], env);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout.trim().split("\n")[0]);
    const cfg = parsed.data.checks.find((c: { name: string }) => c.name === "Config");
    expect(cfg?.status).toBe("warn");
    expect(cfg?.detail).toMatch(/no API key/i);
    expect(cfg?.hint).toMatch(/blazedocs/);
  });
});
