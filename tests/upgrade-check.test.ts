import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bd-upgrade-test-"));
const origHome = process.env.HOME;
const origUserProfile = process.env.USERPROFILE;
const origSkip = process.env.BLAZEDOCS_SKIP_UPDATE_CHECK;

beforeEach(() => {
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.BLAZEDOCS_SKIP_UPDATE_CHECK;
  try {
    fs.rmSync(path.join(tmpHome, ".blazedocs"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  vi.resetModules();
});

afterEach(() => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
  else delete process.env.USERPROFILE;
  if (origSkip !== undefined) process.env.BLAZEDOCS_SKIP_UPDATE_CHECK = origSkip;
  else delete process.env.BLAZEDOCS_SKIP_UPDATE_CHECK;
  vi.restoreAllMocks();
});

describe("checkForUpgrade", () => {
  it("returns null when BLAZEDOCS_SKIP_UPDATE_CHECK=1", async () => {
    process.env.BLAZEDOCS_SKIP_UPDATE_CHECK = "1";
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    const result = await checkForUpgrade("3.0.0");
    expect(result).toBeNull();
  });

  it("returns available=true when registry reports a newer version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "3.1.0" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    const result = await checkForUpgrade("3.0.0");
    expect(result).not.toBeNull();
    expect(result?.available).toBe(true);
    expect(result?.current).toBe("3.0.0");
    expect(result?.latest).toBe("3.1.0");
    expect(result?.install_cmd).toMatch(/npm i -g/);
  });

  it("returns available=false when current === latest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "3.0.0" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    const result = await checkForUpgrade("3.0.0");
    expect(result?.available).toBe(false);
    expect(result?.install_cmd).toBeUndefined();
  });

  it("returns null silently on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    const result = await checkForUpgrade("3.0.0");
    expect(result).toBeNull();
  });

  it("returns null silently on non-200 registry response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    const result = await checkForUpgrade("3.0.0");
    expect(result).toBeNull();
  });

  it("returns null on malformed registry response (missing version)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ oops: "wrong" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    const result = await checkForUpgrade("3.0.0");
    expect(result).toBeNull();
  });

  it("writes cache file after a successful fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "3.2.0" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    await checkForUpgrade("3.0.0");
    const cachePath = path.join(tmpHome, ".blazedocs", "update-check.json");
    expect(fs.existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    expect(cache.latest).toBe("3.2.0");
    expect(typeof cache.checked_at).toBe("number");
  });

  it("deletes corrupt cache file on read", async () => {
    const cacheDir = path.join(tmpHome, ".blazedocs");
    fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, "update-check.json");
    fs.writeFileSync(cachePath, "{ this is not valid json");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "3.2.0" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { checkForUpgrade } = await import("../src/ui/upgrade-check.js");
    const result = await checkForUpgrade("3.0.0");
    expect(result?.latest).toBe("3.2.0");
    // Cache should now be valid JSON again.
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    expect(parsed.latest).toBe("3.2.0");
  });
});
