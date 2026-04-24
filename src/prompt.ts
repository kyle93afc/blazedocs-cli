import * as readline from "readline";

/**
 * Prompt the user for a secret on a TTY with hidden input. Falls back to
 * visible input on non-TTY (should be avoided — callers should pipe via
 * `--api-key-stdin` for non-interactive use).
 */
export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      reject(new Error("No TTY for interactive prompt. Use --api-key-stdin or BLAZEDOCS_API_KEY."));
      return;
    }

    stdout.write(question);

    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });

    // Replace echo with masked output.
    const originalWrite = (stdout as unknown as { write: (chunk: string) => boolean }).write.bind(stdout);
    let muted = true;
    (stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
      if (muted && typeof chunk === "string" && chunk !== question) {
        return originalWrite("");
      }
      return originalWrite(chunk);
    };

    rl.question("", (answer) => {
      muted = false;
      (stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite;
      stdout.write("\n");
      rl.close();
      resolve(answer);
    });

    rl.on("error", (e) => {
      muted = false;
      (stdout as unknown as { write: (chunk: string) => boolean }).write = originalWrite;
      reject(e);
    });
  });
}

export function readStdinAll(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}
