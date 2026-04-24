import { resolveApiKey } from "../config.js";
import { getUsage, normalizeUsage } from "../api.js";
import { AuthError } from "../errors.js";
import type { Renderer } from "../ui/renderers/types.js";

/**
 * Identify the authenticated user and tier.
 *
 * Payload shape (what the renderer receives):
 *   { email: string|null, tier: string, pages_used, pages_limit, pages_remaining }
 *
 * - JsonRenderer wraps in {"type":"result","data":{...}}.
 * - SilentRenderer / ClackRenderer render a human line preserving v2.0.3 format.
 * - RawRenderer prints `<email or tier>\n`.
 */
export async function whoamiCommand(renderer: Renderer): Promise<void> {
  const key = resolveApiKey();
  if (!key) {
    throw new AuthError();
  }
  const snapshot = await getUsage(key);
  const { pagesUsed, pagesLimit, pagesRemaining, tier } = normalizeUsage(snapshot);
  const email = (snapshot.email as string | undefined) ?? null;

  const payload = {
    email,
    tier,
    pages_used: pagesUsed,
    pages_limit: pagesLimit,
    pages_remaining: pagesRemaining,
  };

  renderer.success(payload);
}
