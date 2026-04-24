import { saveConfig } from "../config.js";
import { validateApiKey } from "../api.js";
import { promptSecret, readStdinAll } from "../prompt.js";
import { AuthError } from "../errors.js";

export interface LoginOptions {
  apiKeyStdin?: boolean;
}

export async function loginCommand(opts: LoginOptions): Promise<void> {
  let apiKey: string;

  if (opts.apiKeyStdin) {
    apiKey = (await readStdinAll()).trim();
    if (!apiKey) {
      throw new Error("No API key received on stdin.");
    }
  } else {
    apiKey = (await promptSecret("BlazeDocs API key: ")).trim();
    if (!apiKey) {
      throw new Error("No API key entered.");
    }
  }

  // Validate the key before writing.
  try {
    await validateApiKey(apiKey);
  } catch (e) {
    if (e instanceof AuthError) {
      throw new AuthError("Key rejected by the API. Check the value and try again.");
    }
    throw e;
  }

  saveConfig({ apiKey });
  process.stdout.write("Logged in. Key stored at ~/.blazedocs/config.json (mode 0600).\n");
}
