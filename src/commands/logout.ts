import { clearConfig } from "../config.js";
import type { Renderer } from "../ui/renderers/types.js";

export function logoutCommand(renderer?: Renderer): void {
  clearConfig();
  const payload = { ok: true, message: "Logged out. Stored credentials cleared." };
  if (renderer) {
    renderer.success(payload);
  } else {
    // Fallback for any direct caller — preserves v2.0.3 line.
    process.stdout.write("Logged out. Stored credentials cleared.\n");
  }
}
