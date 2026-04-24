import { resolveApiKey } from "../config.js";
import { getUsage, normalizeUsage } from "../api.js";
import { isInteractive } from "../ui/env.js";
import type { Renderer } from "../ui/renderers/types.js";
import { convertCommand } from "./convert.js";
import { doctorCommand } from "./doctor.js";
import { loginCommand } from "./login.js";
import { skillsInstallCommand } from "./skills.js";
import { usageCommand } from "./usage.js";

export interface InteractiveOptions {
  version: string;
  yes?: boolean;
}

export async function interactiveCommand(
  opts: InteractiveOptions,
  renderer: Renderer,
): Promise<void> {
  if (!isInteractive() || opts.yes) {
    renderer.success({
      message:
        "BlazeDocs CLI. Try `blazedocs` for setup, `blazedocs convert <file.pdf>`, or `blazedocs --help`.",
    });
    return;
  }

  const prompts = await import("../ui/prompts.js");
  prompts.showIntro();

  let hasAuth = Boolean(resolveApiKey());
  if (!hasAuth) {
    renderer.note("First run detected. Let's get you set up.");
    await loginCommand({}, renderer);
    hasAuth = true;
  } else {
    await showCurrentUsage();
  }

  const choice = await prompts.promptMainMenu(hasAuth);
  switch (choice) {
    case "convert":
      await convertCommand([], {}, renderer);
      break;
    case "usage":
      await usageCommand(renderer);
      break;
    case "skill":
      await skillsInstallCommand("core", {}, renderer);
      break;
    case "login":
      await loginCommand({}, renderer);
      break;
    case "doctor":
      await doctorCommand({ version: opts.version }, renderer);
      break;
    case "exit":
      prompts.showOutro("See you next time.");
      break;
  }
}

async function showCurrentUsage(): Promise<void> {
  const key = resolveApiKey();
  if (!key) return;
  try {
    const snapshot = await getUsage(key);
    const normalized = normalizeUsage(snapshot);
    const prompts = await import("../ui/prompts.js");
    prompts.showUsageNote({
      title: "Welcome back",
      email: (snapshot.email as string | undefined) ?? null,
      tier: normalized.tier,
      pagesUsed: normalized.pagesUsed,
      pagesLimit: normalized.pagesLimit,
      pagesRemaining: normalized.pagesRemaining,
    });
  } catch {
    // Keep the menu usable if the network is down. The selected command will
    // render the real error if it also needs the API.
  }
}
