import { resolveApiKey } from "../config.js";
import { getUsage } from "../api.js";
import { AuthError } from "../errors.js";

export async function whoamiCommand(): Promise<void> {
  const key = resolveApiKey();
  if (!key) {
    throw new AuthError("Not authenticated. Run `blazedocs login` or set BLAZEDOCS_API_KEY.");
  }
  const usage = await getUsage(key);
  const email = (usage.email as string | undefined) ?? "unknown";
  const tier = (usage.tier as string | undefined) ?? "unknown";
  process.stdout.write(`${email} (${tier} plan)\n`);
}
