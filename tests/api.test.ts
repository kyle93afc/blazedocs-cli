import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { convertPdf, normalizeUsage } from "../src/api.js";
import { AuthError, QuotaExceededError, NetworkError, ApiError } from "../src/errors.js";

function mkTempPdf(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blazedocs-test-"));
  const file = path.join(dir, "sample.pdf");
  // Minimal PDF-shaped bytes — the server is stubbed, so we only need a file on disk.
  fs.writeFileSync(file, Buffer.from("%PDF-1.4\n%%EOF"));
  return file;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("convertPdf response parsing (regression for v1.1.0 empty-file bug)", () => {
  it("reads markdown from result.data.markdown, not result.markdown", async () => {
    const file = mkTempPdf();
    const stub: typeof fetch = async () =>
      jsonResponse(200, {
        success: true,
        data: {
          markdown: "# Hello",
          page_count: 1,
          token_count: 5,
          processing_time_ms: 100,
          file_name: "sample.pdf",
        },
        usage: { pages_used: 1, pages_limit: 10, pages_remaining: 9 },
      });

    const result = await convertPdf(file, { apiKey: "bd_test_key", fetchImpl: stub });

    expect(result.markdown).toBe("# Hello");
    expect(result.markdown.length).toBeGreaterThan(0);
  });

  it("throws when the API response is missing data.markdown", async () => {
    const file = mkTempPdf();
    const stub: typeof fetch = async () =>
      jsonResponse(200, { success: true, data: {} });

    await expect(convertPdf(file, { apiKey: "bd_test_key", fetchImpl: stub })).rejects.toThrow(
      /data\.markdown/,
    );
  });
});

describe("convertPdf typed errors", () => {
  it("401 → AuthError", async () => {
    const file = mkTempPdf();
    const stub: typeof fetch = async () => jsonResponse(401, { error: "invalid key" });
    await expect(convertPdf(file, { apiKey: "bad", fetchImpl: stub })).rejects.toBeInstanceOf(AuthError);
  });

  it("429 → QuotaExceededError with upgradeUrl", async () => {
    const file = mkTempPdf();
    const stub: typeof fetch = async () =>
      jsonResponse(429, {
        error: "Monthly page limit reached",
        upgrade_required: true,
        upgradeUrl: "https://blazedocs.io/pricing",
      });
    const err = await convertPdf(file, { apiKey: "k", fetchImpl: stub }).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).upgradeUrl).toBe("https://blazedocs.io/pricing");
  });

  it("network error → NetworkError", async () => {
    const file = mkTempPdf();
    const stub: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(convertPdf(file, { apiKey: "k", fetchImpl: stub })).rejects.toBeInstanceOf(NetworkError);
  });

  it("500 with unknown shape → ApiError", async () => {
    const file = mkTempPdf();
    const stub: typeof fetch = async () => jsonResponse(500, { error: "boom" });
    const err = await convertPdf(file, { apiKey: "k", fetchImpl: stub }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});

describe("normalizeUsage — handles both API response shapes (regression for v2.0.1 0/0/0 bug)", () => {
  it("parses nested GET /convert response (usage.monthlyPages + limits.pages)", () => {
    const result = normalizeUsage({
      tier: "business",
      usage: { monthlyConversions: 33, monthlyPages: 859, monthlyTokens: 15353803 },
      limits: { conversions: 1000, pages: 10000, tokens: 10000000, fileSize: 52428800 },
    });
    expect(result.pagesUsed).toBe(859);
    expect(result.pagesLimit).toBe(10000);
    expect(result.pagesRemaining).toBe(9141);
    expect(result.tier).toBe("business");
  });

  it("parses flat POST /convert response (pages_used / pages_limit / pages_remaining)", () => {
    const result = normalizeUsage({
      tier: "starter",
      pages_used: 45,
      pages_limit: 500,
      pages_remaining: 455,
    });
    expect(result.pagesUsed).toBe(45);
    expect(result.pagesLimit).toBe(500);
    expect(result.pagesRemaining).toBe(455);
    expect(result.tier).toBe("starter");
  });

  it("computes remaining when nested shape omits pages_remaining", () => {
    const result = normalizeUsage({
      tier: "pro",
      usage: { monthlyPages: 200 },
      limits: { pages: 2500 },
    });
    expect(result.pagesRemaining).toBe(2300);
  });

  it("returns zeros when the response is empty (graceful fallback, not 0/0/0 bug)", () => {
    // This test documents the fallback — only fires when the API returns
    // neither shape, which should never happen in production.
    const result = normalizeUsage({});
    expect(result.pagesUsed).toBe(0);
    expect(result.pagesLimit).toBe(0);
    expect(result.tier).toBe("unknown");
  });
});
