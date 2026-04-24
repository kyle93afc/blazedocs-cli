/**
 * Static analysis: after `npm run build`, parse dist/bin/blazedocs.js and
 * assert no UI/API/command modules appear in its top-level import graph.
 *
 * Rationale: the `--version` and `--help` latency budget (≤200ms cold) is
 * load-bearing for agents. If someone "helpfully" hoists an import from
 * ../ui/* or ../api.js to the top of bin/blazedocs.ts, we silently pay the
 * cost on every --version call. This test fails loud.
 *
 * Allowed top-level imports: commander only. Everything else must be
 * inside .action() callbacks as `await import(...)`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve("dist", "bin", "blazedocs.js");

describe("bin/blazedocs.ts import guard", () => {
  it("top-level imports contain only commander", () => {
    const source = readFileSync(DIST, "utf-8");
    // tsc emits ESM `import ... from "..."` at the top of the file.
    // Extract top-level static import statements (non-dynamic).
    const staticImportRegex = /^\s*import\s+[^;]*?from\s+["']([^"']+)["']/gm;
    const topLevelImports: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = staticImportRegex.exec(source)) !== null) {
      topLevelImports.push(match[1]);
    }

    // Allowed: commander, or bare node: builtins (if any).
    const disallowed = topLevelImports.filter((mod) => {
      if (mod === "commander") return false;
      if (mod.startsWith("node:")) return false;
      return true; // anything else — UI, API, command, picocolors, semver, clack — is forbidden.
    });

    expect(disallowed).toEqual([]);
  });

  it("UI/API/command modules appear only as dynamic imports", () => {
    const source = readFileSync(DIST, "utf-8");
    const forbiddenAtTopLevel = [
      "../commands/convert.js",
      "../commands/login.js",
      "../commands/usage.js",
      "../commands/whoami.js",
      "../commands/logout.js",
      "../api.js",
      "../ui/renderers/json.js",
      "../ui/renderers/clack.js",
      "../ui/renderer-factory.js",
      "../ui/upgrade-check.js",
      "@clack/prompts",
      "picocolors",
      "semver",
    ];
    // For each forbidden module, if it appears in the file, it must be
    // wrapped in `await import(...)` syntax, not a top-level `import ... from`.
    for (const mod of forbiddenAtTopLevel) {
      const staticImportPattern = new RegExp(
        `^\\s*import[^;]*from\\s+["']${mod.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}["']`,
        "m",
      );
      const matches = source.match(staticImportPattern);
      expect(matches, `${mod} must not be a top-level static import in dist/bin/blazedocs.js`).toBeNull();
    }
  });
});
