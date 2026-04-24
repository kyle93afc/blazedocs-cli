/**
 * Stable error-code enum for BlazeDocs CLI v3.0+.
 *
 * Agents pattern-match on the `code` field in JSON output. Humans read the
 * `message`. Typos on either side = silent API regression, so we derive the
 * TypeScript type from this const to catch mistakes at compile time.
 *
 * New codes MUST be appended here and wired into `exitCodeFor()` below.
 * Never remove a code without a major version bump.
 */
export const ERROR_CODES = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  NETWORK_ERROR: "NETWORK_ERROR",
  API_ERROR: "API_ERROR",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_ARGS: "INVALID_ARGS",
  SKILL_NOT_FOUND: "SKILL_NOT_FOUND",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class BlazeDocsError extends Error {
  code: ErrorCode;
  hint?: string;
  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "BlazeDocsError";
    this.code = code;
    this.hint = hint;
  }
}

export class AuthError extends BlazeDocsError {
  constructor(
    message = "Not authenticated. Run `blazedocs login` or set BLAZEDOCS_API_KEY.",
    hint = "Run `blazedocs login` or set BLAZEDOCS_API_KEY.",
  ) {
    super(ERROR_CODES.AUTH_REQUIRED, message, hint);
    this.name = "AuthError";
  }
}

export class QuotaExceededError extends BlazeDocsError {
  upgradeUrl?: string;
  constructor(message = "Monthly page limit reached.", upgradeUrl?: string) {
    super(
      ERROR_CODES.QUOTA_EXCEEDED,
      message,
      upgradeUrl ? `Upgrade at ${upgradeUrl}` : "Upgrade your plan to continue.",
    );
    this.name = "QuotaExceededError";
    this.upgradeUrl = upgradeUrl;
  }
}

export class NetworkError extends BlazeDocsError {
  constructor(message: string) {
    super(
      ERROR_CODES.NETWORK_ERROR,
      message,
      "Check your connection, then retry. Run `blazedocs doctor` to diagnose.",
    );
    this.name = "NetworkError";
  }
}

export class ApiError extends BlazeDocsError {
  status: number;
  apiCode?: string;
  constructor(status: number, message: string, apiCode?: string) {
    super(ERROR_CODES.API_ERROR, message);
    this.name = "ApiError";
    this.status = status;
    this.apiCode = apiCode;
  }
}

export class FileNotFoundError extends BlazeDocsError {
  path: string;
  constructor(path: string) {
    super(ERROR_CODES.FILE_NOT_FOUND, `File not found: ${path}`);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}

export class InvalidArgsError extends BlazeDocsError {
  constructor(message: string, hint?: string) {
    super(ERROR_CODES.INVALID_ARGS, message, hint);
    this.name = "InvalidArgsError";
  }
}

export class SkillNotFoundError extends BlazeDocsError {
  skillName: string;
  constructor(skillName: string, available: readonly string[]) {
    super(
      ERROR_CODES.SKILL_NOT_FOUND,
      `Unknown skill: ${skillName}`,
      `Available: ${available.join(", ")}. Try \`blazedocs skills list\`.`,
    );
    this.name = "SkillNotFoundError";
    this.skillName = skillName;
  }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof AuthError) return 3;
  if (err instanceof QuotaExceededError) return 2;
  if (err instanceof BlazeDocsError) {
    switch (err.code) {
      case ERROR_CODES.AUTH_REQUIRED:
        return 3;
      case ERROR_CODES.QUOTA_EXCEEDED:
        return 2;
      default:
        return 1;
    }
  }
  return 1;
}

/** Redact API keys from any string before it reaches an error box or log. */
export function redactApiKeys(text: string): string {
  return text.replace(/bd_(?:live|test)_[a-zA-Z0-9_-]+/g, (match) => {
    return match.slice(0, 8) + "…" + "[redacted]";
  });
}
