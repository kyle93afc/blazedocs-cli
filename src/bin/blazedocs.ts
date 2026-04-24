#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "../commands/login.js";
import { logoutCommand } from "../commands/logout.js";
import { whoamiCommand } from "../commands/whoami.js";
import { usageCommand } from "../commands/usage.js";
import { convertCommand } from "../commands/convert.js";
import { QuotaExceededError, exitCodeFor } from "../errors.js";

const VERSION = "2.0.2";

const program = new Command();
program
  .name("blazedocs")
  .description("BlazeDocs CLI — convert PDFs to Markdown.")
  .version(VERSION)
  .showHelpAfterError(true)
  .allowExcessArguments(false);

program
  .command("login")
  .description("Authenticate by storing an API key at ~/.blazedocs/config.json")
  .option("--api-key-stdin", "Read the API key from stdin (preferred for automation)")
  .action(async (opts: { apiKeyStdin?: boolean }) => {
    await run(() => loginCommand({ apiKeyStdin: opts.apiKeyStdin }));
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    run(() => {
      logoutCommand();
      return Promise.resolve();
    });
  });

program
  .command("whoami")
  .description("Show the authenticated user and plan")
  .action(() => {
    run(() => whoamiCommand());
  });

program
  .command("usage")
  .description("Show current-month page usage and quota")
  .option("--json", "Emit raw JSON")
  .action((opts: { json?: boolean }) => {
    run(() => usageCommand({ json: opts.json }));
  });

program
  .command("convert")
  .description("Convert one or more PDFs to Markdown")
  .argument("<inputs...>", "Local PDF paths or http/https URLs")
  .option("-o, --output <path>", "Output file or directory (trailing slash = directory)")
  .option("--json", "Emit the full API response as JSON instead of writing a .md file")
  .option("--silent", "Suppress progress messages on stderr")
  .action((inputs: string[], opts: { output?: string; json?: boolean; silent?: boolean }) => {
    run(() => convertCommand(inputs, opts));
  });

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${message}\n`);
    if (e instanceof QuotaExceededError && e.upgradeUrl) {
      process.stderr.write(`Upgrade: ${e.upgradeUrl}\n`);
    }
    process.exit(exitCodeFor(e));
  }
}

program.parseAsync(process.argv).catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
