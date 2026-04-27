/**
 * `blazedocs skills` subcommands.
 *
 * `install` writes the bundled, version-matched skill to the local skill
 * directory discovered with the same priority used by agent skill installers:
 * project .agents, project .claude, user .agents, then user .claude.
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
    version: process.env.npm_package_version ?? "3.0.0",
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
  return discoverSkillRoot() ?? path.join(process.cwd(), ".agents", "skills");
}

function resolveSkillDir(targetDir: string | undefined, name: string): string {
  const root = targetDir ? expandHome(targetDir) : defaultSkillRoot();
  const resolved = path.resolve(root);
  return path.basename(resolved) === "blazedocs"
    ? resolved
    : path.join(resolved, name === "core" ? "blazedocs" : name);
}

function discoverSkillRoot(): string | null {
  const { project, user } = candidateSkillRoots();

  for (const root of project) {
    if (hasInstalledSkills(root)) return root;
  }
  for (const root of project) {
    if (isExistingDirectory(root)) return root;
  }
  for (const root of user) {
    if (hasInstalledSkills(root)) return root;
  }
  for (const root of user) {
    if (isExistingDirectory(root)) return root;
  }
  return null;
}

function candidateSkillRoots(): { project: string[]; user: string[] } {
  const projectRoots = ancestorDirs(process.cwd()).flatMap((dir) => [
    path.join(dir, ".agents", "skills"),
    path.join(dir, ".claude", "skills"),
  ]);
  return {
    project: projectRoots,
    user: [
      path.join(os.homedir(), ".agents", "skills"),
      path.join(os.homedir(), ".claude", "skills"),
    ],
  };
}

function ancestorDirs(start: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(start);
  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

function hasInstalledSkills(root: string): boolean {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(root, entry.name, "SKILL.md"))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isExistingDirectory(root: string): boolean {
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
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
