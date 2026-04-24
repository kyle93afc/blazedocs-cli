/**
 * Thin picocolors wrapper with BlazeDocs' palette. Picocolors auto-detects
 * TTY / NO_COLOR / FORCE_COLOR itself; we don't override. If `shouldShowColor`
 * returns false the caller should not call these (or picocolors will no-op).
 *
 * Palette rationale (see design doc §Design System):
 *   brand   = yellow  — closest ANSI-16 match to BlazeDocs orange #FF6B35
 *   success = green
 *   warn    = yellow  (same hue as brand; context determines meaning)
 *   error   = red
 *   muted   = gray
 *   accent  = cyan    — hyperlinks, "→ Run:" action indicators
 */
import pc from "picocolors";

export const c = {
  brand: pc.yellow,
  success: pc.green,
  warn: pc.yellow,
  error: pc.red,
  muted: pc.gray,
  accent: pc.cyan,
  bold: pc.bold,
  dim: pc.dim,
};
