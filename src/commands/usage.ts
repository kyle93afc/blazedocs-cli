import { resolveApiKey } from "../config.js";
import { getUsage, normalizeUsage } from "../api.js";
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

  const { pagesUsed, pagesLimit, pagesRemaining, tier } = normalizeUsage(snapshot);
  process.stdout.write(
    `Pages used:      ${pagesUsed}\nPages limit:     ${pagesLimit}\nPages remaining: ${pagesRemaining}\nTier:            ${tier}\n`,
  );
}
