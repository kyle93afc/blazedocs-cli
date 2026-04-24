/**
 * Shared write helper for all renderers.
 *
 * Swallows EPIPE errors that occur when stdout is closed mid-write — a common
 * pattern when users pipe to `head` / `less` / other truncating consumers. The
 * v2.0.3 convert.ts had an inline `safeStdoutWrite`; v3.0 centralized it here
 * so every renderer benefits.
 *
 * Also swallows ERR_STREAM_DESTROYED and broken-pipe errors. The CLI convention
 * for SIGPIPE-ish conditions is to exit 0 cleanly (we let the caller's exit
 * code logic handle that; we just don't crash on write).
 */
export function safeWrite(stream: NodeJS.WritableStream, data: string): void {
  try {
    stream.write(data);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
      // Pipe closed. Standard CLI convention: keep going silently, let the
      // process exit naturally. The caller handles exit codes.
      return;
    }
    // Unknown write errors are rare but we shouldn't swallow them — re-throw
    // so the outer run() catch can format them as structured errors.
    throw e;
  }
}
