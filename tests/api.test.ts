import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { convertPdf, normalizeUsage, displayTier } from "../src/api.js";
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
  it("sends Idempotency-Key on billable convert requests when provided", async () => {
    const file = mkTempPdf();
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const stub: typeof fetch = async (_url, init) => {
      const url = String(_url);
      seen.push({ url, init });
      if (url.endsWith("/upload-url")) {
        return jsonResponse(200, {
          success: true,
          data: { upload_url: "https://upload.example.test/convex" },
        });
      }
      if (url === "https://upload.example.test/convex") {
        return jsonResponse(200, { storageId: "kg29storage" });
      }
      return jsonResponse(200, {
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
    };

    await convertPdf(file, {
      apiKey: "bd_test_key",
      idempotencyKey: "job-123",
      fetchImpl: stub,
    });

    const convertCall = seen.find((entry) => entry.url.endsWith("/convert"));
    expect(convertCall?.init?.headers).toMatchObject({
      "Idempotency-Key": "job-123",
    });
  });

  it("strips unresolved markdown image references from API output", async () => {
    const file = mkTempPdf();
    const stub: typeof fetch = async () =>
      jsonResponse(200, {
        success: true,
        data: {
          markdown: "# Hello\n\n![img-0.jpeg](img-0.jpeg)\n\nText\n\n![Chart](img-1.png)",
          page_count: 1,
          token_count: 5,
          processing_time_ms: 100,
          file_name: "sample.pdf",
        },
        usage: { pages_used: 1, pages_limit: 10, pages_remaining: 9 },
      });

    const result = await convertPdf(file, { apiKey: "bd_test_key", fetchImpl: stub });

    expect(result.markdown).toBe("# Hello\n\nText");
  });

  it("uploads PDFs through direct storage before calling convert", async () => {
    const file = mkTempPdf();
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const stub: typeof fetch = async (_url, init) => {
      const url = String(_url);
      seen.push({ url, init });
      if (url.endsWith("/upload-url")) {
        return jsonResponse(200, {
          success: true,
          data: { upload_url: "https://upload.example.test/convex" },
        });
      }
      if (url === "https://upload.example.test/convex") {
        return jsonResponse(200, { storageId: "kg29storage" });
      }
      return jsonResponse(200, {
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
    };

    await convertPdf(file, { apiKey: "bd_test_key", fetchImpl: stub });

    expect(seen).toHaveLength(3);
    expect(seen[0].url).toContain("/upload-url");
    expect(seen[0].init?.headers).toEqual({
      Authorization: "Bearer bd_test_key",
    });
    expect(seen[1].url).toBe("https://upload.example.test/convex");
    expect(seen[1].init?.body).toBeInstanceOf(File);
    expect(seen[2].url).toContain("/convert");
    expect(seen[2].init?.headers).toEqual({
      Authorization: "Bearer bd_test_key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(seen[2].init?.body))).toMatchObject({
      storage_id: "kg29storage",
      file_name: "sample.pdf",
    });
  });

  it("falls back to multipart when the server does not support upload URLs", async () => {
    const file = mkTempPdf();
    let seenBody: BodyInit | null | undefined;
    const stub: typeof fetch = async (_url, init) => {
      const url = String(_url);
      if (url.endsWith("/upload-url")) {
        return jsonResponse(404, { error: "not found" });
      }
      seenBody = init?.body;
      return jsonResponse(200, {
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
    };

    await convertPdf(file, { apiKey: "bd_test_key", fetchImpl: stub });

    expect(seenBody).toBeInstanceOf(FormData);
  });

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
    // normalizeUsage applies displayTier() — "business" slug maps to "Enterprise" SKU name.
    expect(result.tier).toBe("Enterprise");
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
    expect(result.tier).toBe("Starter");
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

describe("displayTier — maps internal slug to public SKU name", () => {
  it('maps "business" to "Enterprise" (regression for v2.0.2 tier mismatch)', () => {
    expect(displayTier("business")).toBe("Enterprise");
  });

  it('maps "enterprise" to "Enterprise"', () => {
    expect(displayTier("enterprise")).toBe("Enterprise");
  });

  it("preserves other known slugs", () => {
    expect(displayTier("free")).toBe("Free");
    expect(displayTier("starter")).toBe("Starter");
    expect(displayTier("pro")).toBe("Pro");
  });

  it("passes through unknown tier slugs unchanged", () => {
    expect(displayTier("something-new")).toBe("something-new");
  });

  it('returns "unknown" when tier is missing', () => {
    expect(displayTier(undefined)).toBe("unknown");
    expect(displayTier(null)).toBe("unknown");
  });
});
