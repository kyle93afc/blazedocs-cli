/**
 * `blazedocs skills` subcommands.
 *
 * `install` writes the bundled, version-matched skill to a local skill
 * directory. Default path mirrors skill.sh's universal convention:
 * ~/.agents/skills/blazedocs/SKILL.md.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSkill, listSkills } from "../skills/core.js";
import { SkillNotFoundError } from "../errors.js";
import type { Renderer } from "../ui/renderers/types.js";

export interface SkillsInstallOptions {
  targetDir?: string;
  force?: boolean;
}

export async function skillsGetCommand(name: string, renderer: Renderer): Promise<void> {
  const content = getSkill(name);
  if (!content) {
    throw new SkillNotFoundError(name, listSkills());
  }
  // Skills get emits {type:"result", data:{name, content, ...}} under --json.
  // Under --raw, RawRenderer picks up obj.content is not a primary key;
  // we need the raw markdown to stdout for `> SKILL.md` redirection.
  // So: for --raw we expect RawRenderer to recognize `content` as the payload.
  renderer.success({
    name,
    content,
    version: process.env.npm_package_version ?? "3.0.0-beta.6",
  });
}

export async function skillsListCommand(renderer: Renderer): Promise<void> {
  const names = listSkills();
  renderer.success({
    skills: names,
    count: names.length,
    message: names.length === 1 ? `1 skill available: ${names[0]}` : `${names.length} skills: ${names.join(", ")}`,
  });
}

export async function skillsInstallCommand(
  name: string,
  opts: SkillsInstallOptions,
  renderer: Renderer,
): Promise<void> {
  const content = getSkill(name);
  if (!content) {
    throw new SkillNotFoundError(name, listSkills());
  }

  const targetDir = resolveSkillDir(opts.targetDir, name);
  const targetFile = path.join(targetDir, "SKILL.md");
  const existed = fs.existsSync(targetFile);

  if (existed && opts.force !== true && opts.targetDir) {
    renderer.success({
      ok: true,
      installed: false,
      updated: false,
      skipped: true,
      name,
      path: targetFile,
      message: `Skill already exists at ${shortPath(targetFile)}. Re-run with --force to overwrite.`,
    });
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(targetFile, content.endsWith("\n") ? content : `${content}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    try { fs.chmodSync(targetFile, 0o600); } catch { /* best effort */ }
  }

  renderer.success({
    ok: true,
    installed: !existed,
    updated: existed,
    skipped: false,
    name,
    path: targetFile,
    message: `${existed ? "Updated" : "Installed"} ${name} skill at ${shortPath(targetFile)}`,
  });
}

export function defaultSkillRoot(): string {
  return path.join(os.homedir(), ".agents", "skills");
}

function resolveSkillDir(targetDir: string | undefined, name: string): string {
  const root = targetDir ? expandHome(targetDir) : defaultSkillRoot();
  const resolved = path.resolve(root);
  return path.basename(resolved) === "blazedocs"
    ? resolved
    : path.join(resolved, name === "core" ? "blazedocs" : name);
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function shortPath(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) return "~" + p.slice(home.length).replace(/\\/g, "/");
  return p;
}
