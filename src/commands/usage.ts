import { resolveApiKey } from "../config.js";
import { getUsage } from "../api.js";
import { AuthError } from "../errors.js";

export interface UsageOptions {
  json?: boolean;
}

export async function usageCommand(opts: UsageOptions): Promise<void> {
  const key = resolveApiKey();
  if (!key) {
    throw new AuthError("Not authenticated. Run `blazedocs login` or set BLAZEDOCS_API_KEY.");
  }
  const snapshot = await getUsage(key);

  if (opts.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
    return;
  }

  const used = snapshot.pages_used ?? 0;
  const limit = snapshot.pages_limit ?? 0;
  const remaining = snapshot.pages_remaining ?? Math.max(limit - used, 0);
  const tier = (snapshot.tier as string | undefined) ?? "unknown";
  process.stdout.write(
    `Pages used:      ${used}\nPages limit:     ${limit}\nPages remaining: ${remaining}\nTier:            ${tier}\n`,
  );
}
