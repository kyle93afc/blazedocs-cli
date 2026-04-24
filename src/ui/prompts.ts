import * as fs from "node:fs";
import * as path from "node:path";
import {
  intro,
  outro,
  cancel,
  isCancel,
  note,
  password,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { InvalidArgsError } from "../errors.js";
import { renderLogo } from "./logo.js";
import { quotaBar } from "./quota-bar.js";

export { spinner };

export function showIntro(): void {
  process.stderr.write(`\n${renderLogo()}\n\n`);
  intro("BlazeDocs");
}

export function showOutro(message = "Done."): void {
  outro(message);
}

export function showUsageNote(args: {
  title?: string;
  email?: string | null;
  tier: string;
  pagesUsed: number;
  pagesLimit: number;
  pagesRemaining: number;
}): void {
  const emailLine = args.email ? `Signed in as ${args.email}\n` : "";
  note(
    `${emailLine}${args.tier} plan\n${args.pagesUsed}/${args.pagesLimit} pages used\n${quotaBar(
      args.pagesUsed,
      args.pagesLimit,
    )}\n${args.pagesRemaining} pages remaining this month`,
    args.title ?? "BlazeDocs",
  );
}

export async function promptApiKey(): Promise<string> {
  const value = await password({
    message: "Paste your BlazeDocs API key",
    validate(input) {
      if (!input.trim()) return "API key is required.";
      return undefined;
    },
  });
  if (isCancel(value)) abortPrompt();
  return String(value).trim();
}

export type MainMenuChoice = "convert" | "usage" | "login" | "doctor" | "exit";

export async function promptMainMenu(hasAuth: boolean): Promise<MainMenuChoice> {
  const value = await select<MainMenuChoice>({
    message: "What now?",
    options: [
      { value: "convert", label: "Convert a PDF" },
      { value: "usage", label: "Check usage" },
      { value: "login", label: hasAuth ? "Switch API key" : "Log in" },
      { value: "doctor", label: "Run doctor" },
      { value: "exit", label: "Exit" },
    ],
  });
  if (isCancel(value)) abortPrompt();
  return value;
}

export async function promptPdfInput(): Promise<string> {
  const pdfs = fs
    .readdirSync(process.cwd(), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => {
      const fullPath = path.join(process.cwd(), entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, fullPath, stat };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, 20);

  const options = pdfs.map((pdf) => ({
    value: pdf.fullPath,
    label: pdf.name,
    hint: `${formatBytes(pdf.stat.size)}, modified ${formatModified(pdf.stat.mtimeMs)}`,
  }));

  const value = await select<string>({
    message: "What should I convert?",
    options: [
      ...options,
      { value: "__url__", label: "Paste a URL" },
      { value: "__path__", label: "Type a path" },
    ],
  });
  if (isCancel(value)) abortPrompt();

  if (value === "__url__") {
    const input = await text({
      message: "PDF URL",
      validate(v) {
        if (!/^https?:\/\/.+/i.test(v)) return "Enter an http(s) URL.";
        return undefined;
      },
    });
    if (isCancel(input)) abortPrompt();
    return String(input).trim();
  }

  if (value === "__path__") {
    const input = await text({
      message: "PDF path",
      validate(v) {
        const resolved = path.resolve(process.cwd(), String(v));
        if (!fs.existsSync(resolved)) return "File does not exist.";
        return undefined;
      },
    });
    if (isCancel(input)) abortPrompt();
    return path.resolve(process.cwd(), String(input).trim());
  }

  return value;
}

export async function promptOutput(input: string): Promise<string | undefined> {
  const suggested = input.startsWith("http://") || input.startsWith("https://")
    ? path.join(process.cwd(), "download.md")
    : path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.md`);

  const value = await select<string>({
    message: "Output destination?",
    options: [
      { value: suggested, label: `Same folder (${path.basename(suggested)})` },
      { value: "__stdout__", label: "Stdout" },
      { value: "__folder__", label: "Choose folder" },
    ],
  });
  if (isCancel(value)) abortPrompt();
  if (value === "__stdout__") return undefined;
  if (value === "__folder__") {
    const folder = await text({
      message: "Output folder",
      placeholder: process.cwd(),
    });
    if (isCancel(folder)) abortPrompt();
    return path.resolve(process.cwd(), String(folder).trim() || ".") + path.sep;
  }
  return value;
}

function abortPrompt(): never {
  cancel("Cancelled.");
  process.exit(0);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatModified(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.max(1, Math.round(diff / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}
