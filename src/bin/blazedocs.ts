#!/usr/bin/env node
/**
 * BlazeDocs CLI v3.0 entry point.
 *
 * Load-bearing rules (see design doc):
 *   1. Only `commander` is eagerly imported at top level. No UI, no API, no
 *      command modules. `--version` and `--help` must never load clack,
 *      picocolors, semver, api.ts, or any command module.
 *   2. Every command handler is dynamically imported INSIDE its .action()
 *      callback, guarded by `await import(...)`.
 *   3. Global flags `--json`, `--raw`, `--silent`, `--yes` are defined at the
 *      program level and passed to each command via opts merge.
 *   4. `run()` is the single place that constructs a Renderer, invokes the
 *      command, and catches errors. Errors ALWAYS flow through
 *      `renderer.error()`, so --json errors are structured JSON on stderr
 *      with zero bytes on stdout.
 */
import { Command, Option } from "commander";
import type { Renderer } from "../ui/renderers/types.js";

const VERSION = "3.0.0-beta.7";
const KNOWN_COMMANDS = new Set([
  "login",
  "logout",
  "whoami",
  "usage",
  "doctor",
  "skills",
  "convert",
]);

interface GlobalFlags {
  json?: boolean;
  raw?: boolean;
  silent?: boolean;
  yes?: boolean;
}

const program = new Command();
program
  .name("blazedocs")
  .description("Agent-first CLI for PDF → Markdown. JSON everywhere, --raw, structured errors.")
  .version(VERSION)
  .showHelpAfterError(true)
  .allowExcessArguments(false)
  .addOption(
    new Option("--json", "Emit structured JSON on stdout, structured error JSON on stderr"),
  )
  .addOption(
    new Option("--raw", "Emit only the payload (no envelope, no decoration). Implies non-interactive."),
  )
  .addOption(new Option("--silent", "Suppress progress output. Matches v2.0.3 CI behavior."))
  .addOption(
    new Option("--yes", "Accept all interactive defaults non-interactively. Agents/CI set this."),
  )
  .action(async () => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { interactiveCommand } = await import("../commands/interactive.js");
      await interactiveCommand({ version: VERSION, yes: global.yes }, ctx.renderer);
    });
  });

program
  .command("login")
  .description("Authenticate by storing an API key at ~/.blazedocs/config.json")
  .option("--api-key-stdin", "Read the API key from stdin (preferred for automation)")
  .action(async (opts: { apiKeyStdin?: boolean }) => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { loginCommand } = await import("../commands/login.js");
      await loginCommand({ apiKeyStdin: opts.apiKeyStdin }, ctx.renderer);
    });
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(async () => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { logoutCommand } = await import("../commands/logout.js");
      logoutCommand(ctx.renderer);
    });
  });

program
  .command("whoami")
  .description("Show the authenticated user and plan")
  .action(async () => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { whoamiCommand } = await import("../commands/whoami.js");
      await whoamiCommand(ctx.renderer);
    });
  });

program
  .command("usage")
  .description("Show current-month page usage and quota")
  .action(async () => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { usageCommand } = await import("../commands/usage.js");
      await usageCommand(ctx.renderer);
    });
  });

program
  .command("doctor")
  .description("Run self-diagnostic checks (auth, network, config, disk, version)")
  .action(async () => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { doctorCommand } = await import("../commands/doctor.js");
      await doctorCommand({ version: VERSION }, ctx.renderer);
    });
  });

const skillsCmd = program
  .command("skills")
  .description("Manage BlazeDocs skills (agent-discovery docs)");

skillsCmd
  .command("get")
  .description("Print the specified skill's content (default: core)")
  .argument("[name]", "Skill name", "core")
  .action(async (name: string) => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { skillsGetCommand } = await import("../commands/skills.js");
      await skillsGetCommand(name, ctx.renderer);
    });
  });

skillsCmd
  .command("list")
  .description("List available skills")
  .action(async () => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { skillsListCommand } = await import("../commands/skills.js");
      await skillsListCommand(ctx.renderer);
    });
  });

skillsCmd
  .command("install")
  .description("Install the bundled BlazeDocs skill locally (default: ~/.agents/skills)")
  .argument("[name]", "Skill name", "core")
  .option("--target-dir <dir>", "Skill root or blazedocs skill directory")
  .option("--force", "Overwrite an existing skill file")
  .action(async (name: string, opts: { targetDir?: string; force?: boolean }) => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { skillsInstallCommand } = await import("../commands/skills.js");
      await skillsInstallCommand(name, opts, ctx.renderer);
    });
  });

program
  .command("convert")
  .description("Convert one or more PDFs to Markdown")
  .argument("[inputs...]", "Local PDF paths or http/https URLs")
  .option("-o, --output <path>", "Output file or directory (trailing slash = directory)")
  .action(async (inputs: string[], opts: { output?: string }) => {
    const global = program.opts<GlobalFlags>();
    await run(global, async (ctx) => {
      const { convertCommand } = await import("../commands/convert.js");
      await convertCommand(inputs, opts, ctx.renderer);
    });
  });

/**
 * The run wrapper constructs a renderer, invokes the command, and routes any
 * fatal error through renderer.error() so --json gets structured JSON on
 * stderr. Phase 4-6 will progressively migrate command success paths to
 * flow through renderer too. For now, renderer is error-only.
 */
async function run(
  global: GlobalFlags,
  fn: (ctx: { renderer: Renderer }) => Promise<void>,
): Promise<void> {
  // Lazy import — these are never loaded on --version / --help paths.
  const { makeRenderer } = await import("../ui/renderer-factory.js");
  const { checkForUpgrade } = await import("../ui/upgrade-check.js");
  const { BlazeDocsError, InvalidArgsError } = await import("../errors.js");

  // Kick off the upgrade check (non-blocking). Only json + clack use it; raw
  // and silent ignore it. Hold the promise here so the renderer can race it.
  const upgradeCheck =
    global.raw || global.silent
      ? undefined
      : checkForUpgrade(VERSION).catch(() => null);

  const renderer = makeRenderer({ opts: global, upgradeCheck });

  try {
    await fn({ renderer });
    await renderer.close();
  } catch (e) {
    let err = e;
    // Normalize non-BlazeDocsError exceptions into structured errors so JSON
    // output stays well-formed. Preserves original message.
    if (!(err instanceof BlazeDocsError)) {
      const msg = err instanceof Error ? err.message : String(err);
      err = new InvalidArgsError(msg);
    }
    renderer.error(err as InstanceType<typeof BlazeDocsError>);
    await renderer.close();
    const { exitCodeFor } = await import("../errors.js");
    process.exit(exitCodeFor(err));
  }
}

rejectUnknownRootCommand(process.argv);

program.parseAsync(process.argv).catch(async (e) => {
  // Commander parse errors (unknown option, etc). Render structurally if --json.
  const global = program.opts<GlobalFlags>();
  try {
    const { makeRenderer } = await import("../ui/renderer-factory.js");
    const { InvalidArgsError, exitCodeFor } = await import("../errors.js");
    const renderer = makeRenderer({ opts: global });
    const err = new InvalidArgsError(e instanceof Error ? e.message : String(e));
    renderer.error(err);
    await renderer.close();
    process.exit(exitCodeFor(err));
  } catch {
    // Last resort: plain stderr.
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
});

function rejectUnknownRootCommand(argv: string[]): void {
  const args = argv.slice(2);
  const firstCommandLike = args.find((arg) => !arg.startsWith("-"));
  if (!firstCommandLike || KNOWN_COMMANDS.has(firstCommandLike)) return;
  process.stderr.write(`error: unknown command '${firstCommandLike}'\n`);
  process.exit(1);
}
