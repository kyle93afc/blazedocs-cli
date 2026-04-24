/**
 * Regression guard: --raw stderr format is `[CODE] message\n` for every
 * ERROR_CODES value. Agents running `--raw` depend on this regex
 * `/^\[([A-Z_]+)\] /` to parse errors — a typo to `AUTH_REQUIED` or a
 * format change to `AUTH_REQUIRED: ...` would silently break every agent.
 */

import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { RawRenderer } from "../src/ui/renderers/raw.js";
import {
  ERROR_CODES,
  BlazeDocsError,
  AuthError,
  QuotaExceededError,
  NetworkError,
  ApiError,
  FileNotFoundError,
  InvalidArgsError,
  SkillNotFoundError,
} from "../src/errors.js";

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

function errorFor(code: string): BlazeDocsError {
  switch (code) {
    case ERROR_CODES.AUTH_REQUIRED:
      return new AuthError();
    case ERROR_CODES.QUOTA_EXCEEDED:
      return new QuotaExceededError();
    case ERROR_CODES.NETWORK_ERROR:
      return new NetworkError("network down");
    case ERROR_CODES.API_ERROR:
      return new ApiError(500, "server error");
    case ERROR_CODES.FILE_NOT_FOUND:
      return new FileNotFoundError("/tmp/nope.pdf");
    case ERROR_CODES.INVALID_ARGS:
      return new InvalidArgsError("bad args");
    case ERROR_CODES.SKILL_NOT_FOUND:
      return new SkillNotFoundError("nonesuch", ["core"]);
    case ERROR_CODES.INTERNAL:
      return new BlazeDocsError(ERROR_CODES.INTERNAL, "internal error");
    default:
      throw new Error(`Unhandled ERROR_CODES value: ${code}`);
  }
}

describe("RawRenderer error format contract", () => {
  it("every ERROR_CODES value emits `[CODE] message\\n` parseable with /^\\[([A-Z_]+)\\] /", () => {
    const allCodes = Object.values(ERROR_CODES);
    // Sanity: all 8 codes covered by errorFor.
    expect(allCodes.length).toBe(8);

    for (const code of allCodes) {
      const stderr = new Sink();
      const r = new RawRenderer({ stdout: new Sink(), stderr });
      const err = errorFor(code);
      r.error(err);

      const line = stderr.text;
      const match = line.match(/^\[([A-Z_]+)\] /);
      expect(match, `code=${code} did not match /^\\[([A-Z_]+)\\] /`).not.toBeNull();
      expect(match?.[1]).toBe(code);
      expect(line).toMatch(/\n$/);
      // No ANSI escape codes in raw mode error output.
      expect(line).not.toMatch(/\[/);
    }
  });
});
