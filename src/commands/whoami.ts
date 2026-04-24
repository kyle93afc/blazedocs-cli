import { resolveApiKey } from "../config.js";
import { getUsage, normalizeUsage } from "../api.js";
import { AuthError } from "../errors.js";

export async function whoamiCommand(): Promise<void> {
  const key = resolveApiKey();
  if (!key) {
    throw new AuthError("Not authenticated. Run `blazedocs login` or set BLAZEDOCS_API_KEY.");
  }
  const snapshot = await getUsage(key);
  const { pagesUsed, pagesLimit, pagesRemaining, tier } = normalizeUsage(snapshot);
  const email = (snapshot.email as string | undefined) ?? null;

  if (email) {
    process.stdout.write(`${email} (${tier} plan, ${pagesRemaining}/${pagesLimit} pages remaining)\n`);
  } else {
    // API does not currently return email on GET /convert. Fall back to tier + quota.
    process.stdout.write(`${tier} plan — ${pagesUsed}/${pagesLimit} pages used, ${pagesRemaining} remaining\n`);
  }
}
