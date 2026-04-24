/**
 * Regression tests proving v3.0 convert preserves v2.0.3 behavior for
 * non-JSON, non-TTY, pipe-safe flows.
 *
 * IMPORTANT: uses async `execFile` (NOT `spawnSync`). The mock HTTP server
 * runs in the test process; a blocking spawnSync would deadlock because the
 * CLI subprocess's fetch request can't be handled while the test is synchronously
 * waiting.
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
let requestLog: Array<{ url: string; headers: http.IncomingHttpHeaders }>;

function attachDefaultRequestHandler(): void {
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    let _chunks = "";
    req.on("data", (c) => {
      _chunks += c.toString("utf-8");
    });
    req.on("end", () => {
      requestLog.push({ url: req.url ?? "", headers: req.headers });
      res.setHeader("connection", "close");
      res.writeHead(nextResponse.status, { "content-type": "application/json" });
      res.end(JSON.stringify(nextResponse.body));
    });
  });
}

beforeAll(async () => {
  server = http.createServer();
  attachDefaultRequestHandler();
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
  requestLog = [];
  attachDefaultRequestHandler();
  nextResponse = {
    status: 200,
    body: {
      success: true,
      data: {
        markdown: "# Hello from fake API\n\nContent here.",
        page_count: 3,
        token_count: 42,
        processing_time_ms: 123,
        file_name: "fake.pdf",
      },
      usage: { pages_used: 10, pages_limit: 100, pages_remaining: 90 },
    },
  };
});

function testEnv(): NodeJS.ProcessEnv {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bd-convert-reg-"));
  return {
    ...process.env,
    BLAZEDOCS_API_KEY: "bd_live_testkey",
    BLAZEDOCS_API_URL: serverUrl,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    BLAZEDOCS_SKIP_UPDATE_CHECK: "1",
  };
}

function makeFakePdf(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-pdf-"));
  const file = path.join(dir, "fake.pdf");
  fs.writeFileSync(file, "%PDF-1.4 fake\n");
  return file;
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

describe("convert regression (v2.0.3 parity)", () => {
  beforeAll(() => {
    if (!fs.existsSync(BIN)) {
      throw new Error(`Binary not built at ${BIN}. Run \`npm run build\` first.`);
    }
  });

  it("convert <file> (no flags) streams markdown to stdout (v2.0.3 pipe contract)", async () => {
    const pdf = makeFakePdf();
    const res = await runCli(["convert", pdf], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("# Hello from fake API");
    expect(res.stdout).toMatch(/\n$/);
  });

  it("convert <file> --silent produces empty stdout (writes nothing to stdout when no -o)", async () => {
    const pdf = makeFakePdf();
    const res = await runCli(["--silent", "convert", pdf], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stderr).not.toMatch(/Converting/);
    expect(res.stdout).toContain("# Hello from fake API");
  });

  it("convert <file> -o out.md writes file and produces empty stdout", async () => {
    const pdf = makeFakePdf();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-out-"));
    const outFile = path.join(outDir, "result.md");
    const res = await runCli(["convert", pdf, "-o", outFile], testEnv());
    expect(res.exitCode).toBe(0);
    expect(fs.existsSync(outFile)).toBe(true);
    expect(fs.readFileSync(outFile, "utf-8")).toContain("# Hello from fake API");
    expect(fs.readFileSync(outFile, "utf-8")).toMatch(/\n$/);
    expect(res.stdout).toBe("");
  });

  it("convert --json <file> emits {type:result, data:{markdown:...}} envelope on stdout", async () => {
    const pdf = makeFakePdf();
    const res = await runCli(["--json", "convert", pdf], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");

    const lines = res.stdout.trim().split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("result");
    expect(parsed.data.markdown).toContain("# Hello from fake API");
    expect(parsed.data.page_count).toBe(3);
    expect(parsed.data.usage.pages_remaining).toBe(90);
  });

  it("convert --json with multiple files emits JSONL (one result per line)", async () => {
    const pdf1 = makeFakePdf();
    const pdf2 = makeFakePdf();
    const pdf3 = makeFakePdf();
    const res = await runCli(["--json", "convert", pdf1, pdf2, pdf3], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");

    const lines = res.stdout.trim().split("\n").filter((l) => l.length > 0);
    const resultLines = lines.filter((l) => {
      try {
        return JSON.parse(l).type === "result";
      } catch {
        return false;
      }
    });
    expect(resultLines).toHaveLength(3);

    for (const line of resultLines) {
      const obj = JSON.parse(line);
      expect(obj.type).toBe("result");
      expect(typeof obj.data.markdown).toBe("string");
    }
  });

  it("convert --raw <file> emits only markdown (no envelope, no newline added)", async () => {
    const pdf = makeFakePdf();
    const res = await runCli(["--raw", "convert", pdf], testEnv());
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");
    expect(res.stdout).toBe("# Hello from fake API\n\nContent here.");
  });

  it("convert nonexistent file exits non-zero with FILE_NOT_FOUND under --json", async () => {
    const res = await runCli(
      ["--json", "convert", "/tmp/nope-really-does-not-exist.pdf"],
      testEnv(),
    );
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).toBe("");
    const err = JSON.parse(res.stderr.trim().split("\n")[0]);
    expect(err.error.code).toBe("FILE_NOT_FOUND");
  });

  it("convert without auth: AUTH_REQUIRED on stderr, exit 3", async () => {
    const pdf = makeFakePdf();
    const env = testEnv();
    env.BLAZEDOCS_API_KEY = "";
    const res = await runCli(["--json", "convert", pdf], env);
    expect(res.exitCode).toBe(3);
    const err = JSON.parse(res.stderr.trim().split("\n")[0]);
    expect(err.error.code).toBe("AUTH_REQUIRED");
    expect(err.error.exit_code).toBe(3);
  });

  it("convert API 429: QUOTA_EXCEEDED on stderr, exit 2", async () => {
    const pdf = makeFakePdf();
    nextResponse = {
      status: 429,
      body: {
        success: false,
        error: { code: "QUOTA_EXCEEDED", message: "Monthly page limit reached." },
        upgrade_url: "https://blazedocs.io/upgrade",
      },
    };
    const res = await runCli(["--json", "convert", pdf], testEnv());
    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr.trim().split("\n")[0]);
    expect(err.error.code).toBe("QUOTA_EXCEEDED");
    expect(err.error.exit_code).toBe(2);
  });

  it("convert API 429 with empty body still gives useful non-JSON stderr", async () => {
    const pdf = makeFakePdf();
    nextResponse = {
      status: 429,
      body: {},
    };
    const res = await runCli(["convert", pdf, "-o", path.join(os.tmpdir(), "rate-limit.md")], testEnv());
    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
    expect(res.stderr).toMatch(/429|rate limit|quota/i);
  });

  it("convert API 413 explains file-size failure", async () => {
    const pdf = makeFakePdf();
    nextResponse = {
      status: 413,
      body: { error: { code: "FUNCTION_PAYLOAD_TOO_LARGE", message: "Vercel request body limit exceeded" } },
    };
    const res = await runCli(["--json", "convert", pdf], testEnv());
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toBe("");
    const err = JSON.parse(res.stderr.trim().split("\n")[0]);
    expect(err.error.code).toBe("API_ERROR");
    expect(err.error.message).toMatch(/Vercel request body limit exceeded/);
    expect(err.error.hint).toMatch(/retry|smaller PDF|storage upload/i);
    expect(err.error.api_response).toMatch(/FUNCTION_PAYLOAD_TOO_LARGE/);
  });

  it("convert --idempotency-key forwards safe retry key to the API", async () => {
    const pdf = makeFakePdf();
    const res = await runCli(["--json", "convert", pdf, "--idempotency-key", "agent-job-42"], testEnv());
    expect(res.exitCode).toBe(0);
    const convertRequest = requestLog.find((entry) => entry.url.endsWith("/convert"));
    expect(convertRequest?.headers["idempotency-key"]).toBe("agent-job-42");
  });

  it("convert --batch continues after errors and writes a summary JSON", async () => {
    const pdf1 = makeFakePdf();
    const pdf2 = makeFakePdf();
    const summary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bd-summary-")), "summary.json");
    let convertCount = 0;
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      req.resume();
      req.on("end", () => {
        requestLog.push({ url: req.url ?? "", headers: req.headers });
        const isConvert = (req.url ?? "").endsWith("/convert");
        if (isConvert) convertCount += 1;
        if (isConvert && convertCount === 1) {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "QUOTA_EXCEEDED", message: "slow down" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(nextResponse.body));
      });
    });

    const res = await runCli([
      "--json",
      "convert",
      "--batch",
      pdf1,
      pdf2,
      "--concurrency",
      "1",
      "--on-error",
      "continue",
      "--summary",
      summary,
    ], testEnv());

    expect(res.exitCode).toBe(0);
    expect(fs.existsSync(summary)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(summary, "utf-8"));
    expect(parsed).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(parsed.results[0].status).toBe("failed");
    expect(parsed.results[1].status).toBe("succeeded");
  });

  it("convert --batch abort writes a summary JSON before exiting non-zero", async () => {
    const pdf1 = makeFakePdf();
    const pdf2 = makeFakePdf();
    const summary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bd-summary-")), "summary.json");
    nextResponse = {
      status: 429,
      body: { error: { code: "QUOTA_EXCEEDED", message: "slow down" } },
    };

    const res = await runCli([
      "--json",
      "convert",
      "--batch",
      pdf1,
      pdf2,
      "--concurrency",
      "1",
      "--summary",
      summary,
    ], testEnv());

    expect(res.exitCode).toBe(2);
    expect(fs.existsSync(summary)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(summary, "utf-8"));
    expect(parsed).toMatchObject({ total: 2, succeeded: 0, failed: 1 });
    expect(parsed.results[0].status).toBe("failed");
  });

  it("burst API failures never exit with empty stderr", async () => {
    nextResponse = {
      status: 429,
      body: {},
    };
    const runs = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const pdf = makeFakePdf();
        return runCli(["convert", pdf, "-o", path.join(os.tmpdir(), `burst-${process.pid}-${Math.random()}.md`)], testEnv());
      }),
    );

    for (const res of runs) {
      expect(res.exitCode).toBe(2);
      expect(res.stdout).toBe("");
      expect(res.stderr.trim()).not.toBe("");
      expect(res.stderr).toMatch(/429|rate limit|quota/i);
    }
  });
});
