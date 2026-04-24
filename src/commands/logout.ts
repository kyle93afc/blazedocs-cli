import { clearConfig } from "../config.js";

export function logoutCommand(): void {
  clearConfig();
  process.stdout.write("Logged out. Stored credentials cleared.\n");
}
