/**
 * Unit tests for the 4 Renderer implementations.
 * Uses in-process fake writable streams — no child-process spawning needed.
 */

import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { JsonRenderer } from "../src/ui/renderers/json.js";
import { SilentRenderer } from "../src/ui/renderers/silent.js";
import { RawRenderer } from "../src/ui/renderers/raw.js";
import { ClackRenderer } from "../src/ui/renderers/clack.js";
import { AuthError, NetworkError, QuotaExceededError } from "../src/errors.js";

class Sink extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
    cb();
  }
  get text(): string {
    return this.chunks.join("");
  }
}

function sinks(): { stdout: Sink; stderr: Sink } {
  return { stdout: new Sink(), stderr: new Sink() };
}

describe("JsonRenderer", () => {
  it("success emits one JSONL result line to stdout, nothing to stderr", async () => {
    const s = sinks();
    const r = new JsonRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.success({ markdown: "# hello", page_count: 1 });
    await r.close();
    const out = s.stdout.text.trim().split("\n");
    expect(out).toHaveLength(1);
    const obj = JSON.parse(out[0]);
    expect(obj.type).toBe("result");
    expect(obj.data.markdown).toBe("# hello");
    expect(s.stderr.text).toBe("");
  });

  it("multiple success calls produce JSONL (one object per line)", async () => {
    const s = sinks();
    const r = new JsonRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.success({ file: "a.pdf" });
    r.success({ file: "b.pdf" });
    r.success({ file: "c.pdf" });
    await r.close();
    const lines = s.stdout.text.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj.type).toBe("result");
    }
  });

  it("error emits one JSONL error line to stderr, nothing to stdout", async () => {
    const s = sinks();
    const r = new JsonRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.error(new AuthError());
    await r.close();
    expect(s.stdout.text).toBe("");
    const obj = JSON.parse(s.stderr.text.trim());
    expect(obj.error.code).toBe("AUTH_REQUIRED");
    expect(obj.error.exit_code).toBe(3);
    expect(obj.error.hint).toMatch(/blazedocs/);
  });

  it("QuotaExceeded error includes upgrade_url when present", async () => {
    const s = sinks();
    const r = new JsonRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.error(new QuotaExceededError("Limit reached.", "https://blazedocs.io/upgrade"));
    await r.close();
    const obj = JSON.parse(s.stderr.text.trim());
    expect(obj.error.code).toBe("QUOTA_EXCEEDED");
    expect(obj.error.exit_code).toBe(2);
    expect(obj.error.upgrade_url).toBe("https://blazedocs.io/upgrade");
  });

  it("redacts bd_live_ keys from error messages", async () => {
    const s = sinks();
    const r = new JsonRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.error(new NetworkError("Failed with key bd_live_abc123xyz"));
    await r.close();
    expect(s.stderr.text).not.toMatch(/bd_live_abc123xyz/);
    expect(s.stderr.text).toMatch(/redacted/);
  });

  it("progress and note suppressed by default", async () => {
    const s = sinks();
    const r = new JsonRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.progress("working");
    r.note("tip");
    await r.close();
    expect(s.stdout.text).toBe("");
    expect(s.stderr.text).toBe("");
  });

  it("emits meta line when upgradeCheck resolves with available upgrade", async () => {
    const s = sinks();
    const r = new JsonRenderer({
      stdout: s.stdout,
      stderr: s.stderr,
      upgradeCheck: Promise.resolve({
        available: true,
        current: "3.0.0",
        latest: "3.1.0",
        install_cmd: "npm i -g blazedocs@latest",
        install_cmds: [
          { manager: "npm", command: "npm i -g blazedocs@latest" },
          { manager: "bun", command: "bun add -g blazedocs@latest" },
        ],
      }),
    });
    r.success({ ok: true });
    await r.close();
    const lines = s.stdout.text.trim().split("\n");
    expect(lines).toHaveLength(2);
    const meta = JSON.parse(lines[1]);
    expect(meta.type).toBe("meta");
    expect(meta.upgrade.latest).toBe("3.1.0");
    expect(meta.upgrade.install_cmds).toContainEqual({
      manager: "bun",
      command: "bun add -g blazedocs@latest",
    });
  });

  it("does NOT emit meta when upgrade check returns not-available", async () => {
    const s = sinks();
    const r = new JsonRenderer({
      stdout: s.stdout,
      stderr: s.stderr,
      upgradeCheck: Promise.resolve({ available: false, current: "3.0.0", latest: "3.0.0" }),
    });
    r.success({ ok: true });
    await r.close();
    const lines = s.stdout.text.trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("close() times out within 500ms if upgradeCheck hangs", async () => {
    const s = sinks();
    const hungCheck = new Promise<null>(() => {
      /* never resolves */
    });
    const r = new JsonRenderer({
      stdout: s.stdout,
      stderr: s.stderr,
      upgradeCheck: hungCheck,
      upgradeTimeoutMs: 50,
    });
    r.success({ ok: true });
    const start = Date.now();
    await r.close();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe("SilentRenderer", () => {
  it("emits markdown string to stdout when payload has .markdown", async () => {
    const s = sinks();
    const r = new SilentRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.success({ markdown: "# hello" });
    await r.close();
    expect(s.stdout.text).toBe("# hello\n");
    expect(s.stderr.text).toBe("");
  });

  it("preserves existing trailing newline in markdown", async () => {
    const s = sinks();
    const r = new SilentRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.success({ markdown: "# hello\n" });
    await r.close();
    expect(s.stdout.text).toBe("# hello\n");
  });

  it("error emits plain message + newline to stderr (v2.0.3 parity)", async () => {
    const s = sinks();
    const r = new SilentRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.error(new AuthError());
    await r.close();
    expect(s.stdout.text).toBe("");
    expect(s.stderr.text).toMatch(/Not authenticated/);
    expect(s.stderr.text).toMatch(/\n$/);
  });

  it("progress and note are silent", async () => {
    const s = sinks();
    const r = new SilentRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.progress("working");
    r.note("tip");
    await r.close();
    expect(s.stdout.text).toBe("");
    expect(s.stderr.text).toBe("");
  });
});

describe("RawRenderer", () => {
  it("emits markdown string verbatim to stdout (no envelope, no newline added)", async () => {
    const s = sinks();
    const r = new RawRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.success({ markdown: "# hello" });
    await r.close();
    expect(s.stdout.text).toBe("# hello");
  });

  it("error emits [CODE] message line to stderr", async () => {
    const s = sinks();
    const r = new RawRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.error(new AuthError("key invalid"));
    await r.close();
    expect(s.stdout.text).toBe("");
    expect(s.stderr.text).toMatch(/^\[AUTH_REQUIRED\] /);
    expect(s.stderr.text).toMatch(/\n$/);
  });

  it("all ERROR_CODES emit parseable [CODE] format", async () => {
    const s = sinks();
    const r = new RawRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.error(new NetworkError("timeout"));
    await r.close();
    expect(s.stderr.text).toMatch(/^\[NETWORK_ERROR\] /);
  });

  it("progress and note are silent", async () => {
    const s = sinks();
    const r = new RawRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.progress("working");
    r.note("tip");
    await r.close();
    expect(s.stdout.text).toBe("");
    expect(s.stderr.text).toBe("");
  });
});

describe("ClackRenderer", () => {
  it("progress writes to stderr with a muted prefix", async () => {
    const s = sinks();
    const r = new ClackRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.progress("Converting");
    await r.close();
    expect(s.stdout.text).toBe("");
    expect(s.stderr.text).toMatch(/Converting/);
  });

  it("error writes code + message + hint to stderr", async () => {
    const s = sinks();
    const r = new ClackRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.error(new AuthError());
    await r.close();
    expect(s.stdout.text).toBe("");
    expect(s.stderr.text).toMatch(/AUTH_REQUIRED/);
    expect(s.stderr.text).toMatch(/blazedocs/);
  });

  it("note writes to stderr with a muted prefix", async () => {
    const s = sinks();
    const r = new ClackRenderer({ stdout: s.stdout, stderr: s.stderr });
    r.note("Tip: run blazedocs doctor");
    await r.close();
    expect(s.stderr.text).toMatch(/doctor/);
  });

  it("emits upgrade notice on stderr when upgrade is available", async () => {
    const s = sinks();
    const r = new ClackRenderer({
      stdout: s.stdout,
      stderr: s.stderr,
      upgradeCheck: Promise.resolve({
        available: true,
        current: "3.0.0",
        latest: "3.1.0",
        install_cmd: "npm i -g blazedocs@latest",
        install_cmds: [
          { manager: "npm", command: "npm i -g blazedocs@latest" },
          { manager: "pnpm", command: "pnpm add -g blazedocs@latest" },
          { manager: "yarn", command: "yarn global add blazedocs@latest" },
          { manager: "bun", command: "bun add -g blazedocs@latest" },
        ],
      }),
    });
    r.success({ message: "done" });
    await r.close();
    expect(s.stderr.text).toMatch(/3\.1\.0/);
    expect(s.stderr.text).toMatch(/npm i -g/);
    expect(s.stderr.text).toMatch(/bun add -g/);
  });
});
