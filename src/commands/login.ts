import * as readline from "node:readline";
import { saveConfig } from "../config.js";
import { validateApiKey } from "../api.js";
import { readStdinAll } from "../stdin.js";
import { AuthError } from "../errors.js";

export interface LoginOptions {
  apiKeyStdin?: boolean;
}

/**
 * Masked readline prompt. Kept inline for v3.0-beta.1; Phase 5 replaces this
 * with `@clack/prompts.password()` when the TTY wizard ships.
 */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      reject(new Error("No TTY for interactive prompt. Use --api-key-stdin or BLAZEDOCS_API_KEY."));
      return;
    }

    stdout.write(question);

    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    const originalWrite = (stdout as unknown as { write: (chunk: string) => boolean }).write.bind(stdout);
    let muted = true;
    (stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
      if (muted && typeof chunk === "string" && chunk !== question) {
        return originalWrite("");
      }
      return originalWrite(chunk);
    };

    rl.question("", (answer) => {
      muted = false;
      (stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite;
      stdout.write("\n");
      rl.close();
      resolve(answer);
    });

    rl.on("error", (e) => {
      muted = false;
      (stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite;
      reject(e);
    });
  });
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
