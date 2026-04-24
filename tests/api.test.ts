import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { convertPdf } from "../src/api.js";
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
