import { resolveApiKey } from "../config.js";
import { getUsage, normalizeUsage } from "../api.js";
import { AuthError } from "../errors.js";
import type { Renderer } from "../ui/renderers/types.js";

/**
 * Show current-month page usage.
 *
 * Output shape (per renderer):
 *   - JsonRenderer:   {"type":"result","data":<full snapshot + normalized>} on stdout.
 *   - RawRenderer:    plain `<used>/<limit>\n` on stdout.
 *   - SilentRenderer: v2.0.3-parity 4-line key/value dump on stdout.
 *   - ClackRenderer:  Phase 7 upgrades to a quota-bar box; the initial v3 release uses the
 *                     SilentRenderer's 4-line format via the default generic
 *                     success handler.
 */
export async function usageCommand(renderer: Renderer): Promise<void> {
  const key = resolveApiKey();
  if (!key) {
    throw new AuthError();
  }
  const snapshot = await getUsage(key);
  const normalized = normalizeUsage(snapshot);

  // Payload carries both the raw API snapshot (for agents who want it) and
  // the normalized view (for humans and simple consumers). Renderer picks
  // what to display.
  const payload = {
    ...snapshot,
    pages_used: normalized.pagesUsed,
    pages_limit: normalized.pagesLimit,
    pages_remaining: normalized.pagesRemaining,
    tier: normalized.tier,
  };

  renderer.success(payload);
}
