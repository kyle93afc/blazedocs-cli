import { c } from "./colors.js";

export function quotaBar(used: number, limit: number, width = 28): string {
  if (!Number.isFinite(limit) || limit <= 0) return c.muted("usage unavailable");
  const ratio = Math.max(0, Math.min(1, used / limit));
  const filled = Math.round(ratio * width);
  const empty = Math.max(width - filled, 0);
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const color = ratio >= 0.9 ? c.error : ratio >= 0.7 ? c.warn : c.success;
  return `${color(bar)} ${Math.round(ratio * 100)}%`;
}

