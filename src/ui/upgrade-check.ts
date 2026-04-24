/**
 * Async upgrade check against registry.npmjs.org. Runs fire-and-forget on
 * every non-version/non-help invocation. Populates `meta.upgrade` in JSON
 * output and the boxed TTY notice for humans.
 *
 * Why not `npm view`: spawning another Node process adds hundreds of ms. We
 * hit the registry directly with fetch + AbortController. 500ms budget.
 * Silent on any failure — the check is best-effort.
 *
 * Concurrency: cache is written via `tmpfile + rename` so two parallel
 * invocations can't tear the JSON. Corrupt file on read → delete + refetch.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as semver from "semver";
import type { UpgradeInfo } from "./renderers/types.js";

const PACKAGE_NAME = "blazedocs";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 500;
const CACHE_SCHEMA_VERSION = 2;

interface CacheShape {
  schema_version: number;
  latest: string;
  checked_at: number;
}

function cachePath(): string {
  return path.join(os.homedir(), ".blazedocs", "update-check.json");
}

function readCache(): CacheShape | null {
  const p = cachePath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as CacheShape;
    if (parsed.schema_version !== CACHE_SCHEMA_VERSION) {
      return null;
    }
    if (typeof parsed.latest !== "string" || typeof parsed.checked_at !== "number") {
      return null;
    }
    if (Date.now() - parsed.checked_at > CACHE_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    // Corrupt cache or no file. Try to delete corrupt file so next invocation is clean.
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
    return null;
  }
}

function writeCache(latest: string): void {
  const p = cachePath();
  const dir = path.dirname(p);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmpPath = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify({ schema_version: CACHE_SCHEMA_VERSION, latest, checked_at: Date.now() }));
    fs.renameSync(tmpPath, p);
  } catch {
    /* best effort — cache write failure should not break anything */
  }
}

function shouldSkip(): boolean {
  if (process.env.BLAZEDOCS_SKIP_UPDATE_CHECK === "1") return true;
  // Skip when we're in a non-TTY, non-JSON context — nobody will read the output.
  // Caller responsibility: pass --json to force the check to fire in piped contexts.
  return false;
}

function pickHighestVersion(versions: string[]): string | null {
  const valid = versions.filter((version) => semver.valid(version));
  if (valid.length === 0) return null;
  return valid.sort((a, b) => semver.rcompare(a, b))[0];
}

async function fetchLatest(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      version?: string;
      "dist-tags"?: Record<string, string>;
      versions?: Record<string, unknown>;
    };

    const candidates = [
      body.version,
      ...Object.values(body["dist-tags"] ?? {}),
      ...Object.keys(body.versions ?? {}),
    ].filter((version): version is string => typeof version === "string");

    const highest = pickHighestVersion(candidates);
    if (highest) {
      return highest;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire the upgrade check. Resolves to `UpgradeInfo | null` within ~500ms
 * worst case. Call this once per invocation, hold the promise at module
 * scope, await at render time with `Promise.race([check, timeout(500)])`.
 */
export async function checkForUpgrade(currentVersion: string): Promise<UpgradeInfo | null> {
  if (shouldSkip()) return null;

  const cached = readCache();
  let latest = cached?.latest ?? null;

  if (!cached) {
    latest = await fetchLatest();
    if (latest) writeCache(latest);
  } else {
    // Cache is warm; refresh in the background without blocking this call.
    // Fire-and-forget: the next invocation sees fresher data.
    fetchLatest()
      .then((fresh) => {
        if (fresh && fresh !== cached.latest) writeCache(fresh);
      })
      .catch(() => {
        /* silent */
      });
  }

  if (!latest) return null;

  let available = false;
  try {
    available = semver.gt(latest, currentVersion);
  } catch {
    return null;
  }

  return {
    available,
    current: currentVersion,
    latest,
    install_cmd: available ? `npm i -g ${PACKAGE_NAME}@${latest}` : undefined,
  };
}
