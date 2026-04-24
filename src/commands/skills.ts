/**
 * `blazedocs skills` subcommands.
 *
 * v3.0 beta ships `get` and `list` only. `add <target-dir>` is deferred
 * per the codex outside-voice review: writing into agent
 * skill directories (Claude Code, Cursor, Codex) is a bigger security
 * surface than the rest of v3, and beta 1 ships a smaller attack surface.
 *
 * Beta users who want to install the skill manually:
 *   blazedocs skills get core > ~/.claude/skills/blazedocs/SKILL.md
 */

import { getSkill, listSkills } from "../skills/core.js";
import { SkillNotFoundError } from "../errors.js";
import type { Renderer } from "../ui/renderers/types.js";

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
    version: process.env.npm_package_version ?? "3.0.0-beta.2",
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
