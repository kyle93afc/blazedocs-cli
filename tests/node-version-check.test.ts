import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { checkNodeVersion, parseMajor, REQUIRED_MAJOR } = require("../scripts/check-node-version.cjs");

describe("scripts/check-node-version.cjs", () => {
  it("requires Node 18 (matches package.json engines.node)", () => {
    expect(REQUIRED_MAJOR).toBe(18);
  });

  it("accepts the running Node version (test machine is >=18)", () => {
    const r = checkNodeVersion();
    expect(r.ok).toBe(true);
    expect(r.message).toBeNull();
  });

  it("rejects Node 12 with a BlazeDocs-branded message naming the detected version", () => {
    const r = checkNodeVersion("12.22.9");
    expect(r.ok).toBe(false);
    expect(r.current).toBe("12.22.9");
    expect(r.message).toMatch(/BlazeDocs CLI requires Node\.js 18 or later/);
    expect(r.message).toMatch(/v12\.22\.9/);
    expect(r.message).toMatch(/npm install -g blazedocs@latest/);
  });

  it("rejects Node 16 (just below threshold)", () => {
    const r = checkNodeVersion("16.20.2");
    expect(r.ok).toBe(false);
  });

  it("accepts Node 18.0.0 (exact threshold)", () => {
    const r = checkNodeVersion("18.0.0");
    expect(r.ok).toBe(true);
  });

  it("accepts Node 20 and 22", () => {
    expect(checkNodeVersion("20.10.0").ok).toBe(true);
    expect(checkNodeVersion("22.5.1").ok).toBe(true);
  });

  it("strips a leading 'v' if present", () => {
    expect(parseMajor("v18.0.0")).toBe(18);
    expect(parseMajor("18.0.0")).toBe(18);
  });

  it("returns 0 for empty/garbage input", () => {
    expect(parseMajor("")).toBe(0);
    expect(parseMajor(undefined)).toBe(0);
    expect(parseMajor("not-a-version")).toBe(0);
  });
});
