import { c } from "./colors.js";
import { isUnicodeCapable, terminalCols } from "./env.js";

const LOGO_WIDE = [
  " ____  _                _____                 ",
  "|  _ \\| |              |  __ \\                ",
  "| |_) | | __ _ _______ | |  | | ___   ___ ___ ",
  "|  _ <| |/ _` |_  / _ \\| |  | |/ _ \\ / __/ __|",
  "| |_) | | (_| |/ /  __/| |__| | (_) | (__\\__ \\",
  "|____/|_|\\__,_/___\\___||_____/ \\___/ \\___|___/",
  "              PDFs in. Markdown out.",
];

const LOGO_NARROW = [
  " ____  _            ",
  "| __ )| | __ _ ______",
  "|  _ \\| |/ _` |_  / _ \\",
  "| |_) | | (_| |/ /  __/",
  "|____/|_|\\__,_/___\\___|",
  "   PDFs in. Markdown out.",
];

const LOGO_ASCII = [
  " ____  _                _____                 ",
  "|  _ \\| |              |  __ \\                ",
  "| |_) | | __ _ _______ | |  | | ___   ___ ___ ",
  "|  _ <| |/ _` |_  / _ \\| |  | |/ _ \\ / __/ __|",
  "| |_) | | (_| |/ /  __/| |__| | (_) | (__\\__ \\",
  "|____/|_|\\__,_/___\\___||_____/ \\___/ \\___|___/",
  "              PDFs in. Markdown out.",
];

export function logoLines(cols = terminalCols(), unicode = isUnicodeCapable()): string[] {
  if (!unicode) return LOGO_ASCII;
  return cols >= 58 ? LOGO_WIDE : LOGO_NARROW;
}

export function renderLogo(): string {
  return logoLines().map((line) => c.brand(line)).join("\n");
}
