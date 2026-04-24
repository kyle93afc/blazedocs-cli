/**
 * `blazedocs doctor` — diagnostic command.
 *
 * Runs 7 checks in parallel, emits a structured report. Agents call
 * `doctor --json` after a failure to decide: retry, re-auth, or escalate.
 * Humans get a boxed per-check list in Phase 7; beta 1 uses the generic
 * SilentRenderer format.
 *
 * Check status enum: "pass" | "warn" | "fail". "warn" is reserved for
 * conditions like "config exists but no apiKey" — degraded but not fatal.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { configPath, loadConfig } from "../config.js";
import { API_BASE, getUsage } from "../api.js";
import type { Renderer } from "../ui/renderers/types.js";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  overall: "pass" | "warn" | "fail";
  version: string;
}

async function checkAuth(): Promise<DoctorCheck> {
  const envKey = process.env.BLAZEDOCS_API_KEY;
  const cfg = loadConfig();
  const key = envKey || cfg.apiKey;

  if (!key) {
    return {
      name: "Auth",
      status: "fail",
      detail: "No API key found.",
      hint: "Run `blazedocs login` or set BLAZEDOCS_API_KEY.",
    };
  }

  try {
    const snap = await getUsage(key);
    const tier = typeof snap.tier === "string" ? snap.tier : "unknown";
    const email = typeof snap.email === "string" ? snap.email : null;
    return {
      name: "Auth",
      status: "pass",
      detail: email ? `${email} (${tier})` : `${tier} plan`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      name: "Auth",
      status: "fail",
      detail: `Key validation failed: ${msg}`,
      hint: "Key may be revoked. Re-run `blazedocs login`.",
    };
  }
}

function checkPartialConfig(): DoctorCheck {
  // Covers codex outside-voice finding #4: a config file exists but has no
  // apiKey (partial setup, manual edit, etc). First-run detection treats
  // this as "not first run" so the wizard doesn't retrigger; doctor makes
  // the state visible.
  const p = configPath();
  if (!fs.existsSync(p)) {
    return {
      name: "Config",
      status: "pass",
      detail: "No config file (expected for fresh install or env-only auth).",
    };
  }
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    return {
      name: "Config",
      status: "warn",
      detail: "Config file present but no API key.",
      hint: "Run `blazedocs login` to set one.",
    };
  }
  return {
    name: "Config",
    status: "pass",
    detail: `API key stored at ${p}`,
  };
}

async function checkNetwork(): Promise<DoctorCheck> {
  // Probe the API host with a HEAD request, 2s timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(API_BASE, { method: "HEAD", signal: controller.signal });
    // Any response (including 4xx) means the host is reachable.
    return {
      name: "Network",
      status: "pass",
      detail: `${API_BASE} reachable (HTTP ${res.status})`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      name: "Network",
      status: "fail",
      detail: `Cannot reach ${API_BASE}: ${msg}`,
      hint: "Check your internet connection, proxy, or firewall.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function checkNodeVersion(): DoctorCheck {
  const v = process.versions.node;
  const major = parseInt(v.split(".")[0], 10);
  if (Number.isNaN(major) || major < 18) {
    return {
      name: "Node",
      status: "fail",
      detail: `Node ${v} is below the v3.0 minimum of 18.0.`,
      hint: "Upgrade Node: https://nodejs.org",
    };
  }
  return { name: "Node", status: "pass", detail: `v${v}` };
}

function checkConfigPerms(): DoctorCheck {
  if (process.platform === "win32") {
    return {
      name: "Config perms",
      status: "pass",
      detail: "Windows — ACLs not checked.",
    };
  }
  const p = configPath();
  if (!fs.existsSync(p)) {
    return {
      name: "Config perms",
      status: "pass",
      detail: "No config file to check.",
    };
  }
  try {
    const st = fs.statSync(p);
    const mode = st.mode & 0o777;
    if (mode !== 0o600) {
      return {
        name: "Config perms",
        status: "warn",
        detail: `Mode is ${mode.toString(8)}, expected 600.`,
        hint: `Run: chmod 600 ${p}`,
      };
    }
    return { name: "Config perms", status: "pass", detail: `${p} (mode 0600)` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name: "Config perms", status: "fail", detail: `stat failed: ${msg}` };
  }
}

function checkDiskSpace(): DoctorCheck {
  try {
    const tmpDir = os.tmpdir();
    const stat = fs.statfsSync
      ? fs.statfsSync(tmpDir)
      : null;
    if (!stat) {
      return {
        name: "Disk",
        status: "pass",
        detail: "statfs unavailable on this platform; not checked.",
      };
    }
    const freeBytes = stat.bavail * stat.bsize;
    const freeMB = Math.floor(freeBytes / (1024 * 1024));
    if (freeMB < 100) {
      return {
        name: "Disk",
        status: "warn",
        detail: `Only ${freeMB} MB free in ${tmpDir}.`,
        hint: "PDFs are buffered to temp during upload; free some space.",
      };
    }
    return {
      name: "Disk",
      status: "pass",
      detail: `${freeMB} MB free in ${tmpDir}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      name: "Disk",
      status: "pass",
      detail: `statfs threw (${msg}); skipping.`,
    };
  }
}

async function checkCliVersion(currentVersion: string): Promise<DoctorCheck> {
  if (process.env.BLAZEDOCS_SKIP_UPDATE_CHECK === "1") {
    return {
      name: "CLI version",
      status: "pass",
      detail: `v${currentVersion} (update check skipped)`,
    };
  }
  try {
    const { checkForUpgrade } = await import("../ui/upgrade-check.js");
    const info = await checkForUpgrade(currentVersion);
    if (!info) {
      return {
        name: "CLI version",
        status: "pass",
        detail: `v${currentVersion}`,
      };
    }
    if (info.available) {
      return {
        name: "CLI version",
        status: "warn",
        detail: `v${currentVersion} — latest is v${info.latest}`,
        hint: info.install_cmd ?? "Upgrade via npm.",
      };
    }
    return { name: "CLI version", status: "pass", detail: `v${currentVersion} (latest)` };
  } catch {
    return {
      name: "CLI version",
      status: "pass",
      detail: `v${currentVersion} (check failed silently)`,
    };
  }
}

export interface DoctorOptions {
  version: string;
}

export async function doctorCommand(
  opts: DoctorOptions,
  renderer: Renderer,
): Promise<void> {
  const checks = await Promise.all([
    checkAuth(),
    Promise.resolve(checkPartialConfig()),
    checkNetwork(),
    Promise.resolve(checkNodeVersion()),
    Promise.resolve(checkConfigPerms()),
    Promise.resolve(checkDiskSpace()),
    checkCliVersion(opts.version),
  ]);

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const overall: "pass" | "warn" | "fail" = hasFail ? "fail" : hasWarn ? "warn" : "pass";

  const report: DoctorReport = { checks, overall, version: opts.version };
  renderer.success(report);
}
