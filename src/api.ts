import * as fs from "fs";
import * as path from "path";
import { AuthError, QuotaExceededError, NetworkError, ApiError } from "./errors.js";

/**
 * API base URL resolution with hard security guards.
 *
 * The default is the production BlazeDocs API. Users can override via
 * BLAZEDOCS_API_URL for self-hosted deployments or staging environments.
 *
 * Guards (otherwise the API key would leak to any host an attacker-controlled
 * env var points at):
 *   1. Only http://localhost OR http://127.0.0.1 is allowed for http://.
 *      Any other http:// URL is rejected at module load.
 *   2. Any other scheme (file://, javascript:, etc) is rejected.
 *   3. When the override is in effect, a one-time warning goes to stderr so
 *      the user sees it. Suppressed under BLAZEDOCS_SUPPRESS_API_URL_WARNING=1.
 */
function resolveApiBase(): string {
  const override = process.env.BLAZEDOCS_API_URL;
  if (!override) return "https://blazedocs.io/api/v1";

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error(
      `BLAZEDOCS_API_URL is not a valid URL: ${override}. Must be https://host/path or http://localhost/...`,
    );
  }

  if (parsed.protocol === "https:") {
    // Accept any https:// (self-hosted, staging, prod).
  } else if (parsed.protocol === "http:") {
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    if (!isLocal) {
      throw new Error(
        `BLAZEDOCS_API_URL uses http:// on a non-local host (${parsed.hostname}). Your API key would leak in plaintext. Use https:// or set the host to localhost.`,
      );
    }
  } else {
    throw new Error(
      `BLAZEDOCS_API_URL scheme "${parsed.protocol}" is not allowed. Use https:// (or http://localhost for dev).`,
    );
  }

  // Only warn on interactive stderr. Under --json or any piped stderr the
  // warning would be structured-output pollution; agents pattern-match on
  // the stream contents, humans see this warning in a TTY.
  const shouldWarn =
    !process.env.BLAZEDOCS_SUPPRESS_API_URL_WARNING &&
    process.stderr.isTTY;
  if (shouldWarn) {
    process.stderr.write(
      `⚠ BLAZEDOCS_API_URL override active: ${override} (set BLAZEDOCS_SUPPRESS_API_URL_WARNING=1 to silence)\n`,
    );
  }
  return override;
}

export const API_BASE = resolveApiBase();

export interface ConvertResult {
  markdown: string;
  page_count: number;
  token_count: number;
  processing_time_ms: number;
  file_name: string;
  usage: {
    pages_used: number;
    pages_limit: number;
    pages_remaining: number;
  };
}

export interface UsageSnapshot {
  // Flat shape (POST /convert response's `usage` field)
  pages_used?: number;
  pages_limit?: number;
  pages_remaining?: number;
  // Nested shape (GET /convert response)
  usage?: {
    monthlyConversions?: number;
    monthlyPages?: number;
    monthlyTokens?: number;
  };
  limits?: {
    conversions?: number;
    pages?: number;
    tokens?: number;
    fileSize?: number;
  };
  tier?: string;
  email?: string;
  [k: string]: unknown;
}

/**
 * Map the API's internal tier slug to the public display name.
 * The backend currently uses "business" as the internal slug for the
 * public "Enterprise" SKU — this map keeps the CLI output aligned with
 * what users see in the dashboard and on the pricing page.
 *
 * Remove this map once the server normalizes the tier field (tracked
 * in the monorepo TODOS.md under "Unified error contract for /api/v1/*").
 */
const TIER_DISPLAY_NAMES: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Enterprise",
  enterprise: "Enterprise",
};

export function displayTier(tier?: string | null): string {
  if (!tier) return "unknown";
  return TIER_DISPLAY_NAMES[tier.toLowerCase()] ?? tier;
}

/** Normalize a usage response regardless of shape (flat or nested). */
export function normalizeUsage(snapshot: UsageSnapshot): {
  pagesUsed: number;
  pagesLimit: number;
  pagesRemaining: number;
  tier: string;
} {
  const pagesUsed = snapshot.pages_used ?? snapshot.usage?.monthlyPages ?? 0;
  const pagesLimit = snapshot.pages_limit ?? snapshot.limits?.pages ?? 0;
  const pagesRemaining =
    snapshot.pages_remaining ?? Math.max(pagesLimit - pagesUsed, 0);
  const tier = displayTier(snapshot.tier);
  return { pagesUsed, pagesLimit, pagesRemaining, tier };
}

interface ApiErrorBody {
  success?: false;
  error?: string | { code?: string; message?: string };
  code?: string;
  message?: string;
  upgrade_required?: boolean;
  upgradeUrl?: string;
  upgrade_url?: string;
}

function parseErrorBody(body: ApiErrorBody): { code?: string; message: string; upgradeUrl?: string } {
  let code: string | undefined;
  let message: string;
  if (typeof body.error === "string") {
    message = body.error;
  } else if (body.error && typeof body.error === "object") {
    code = body.error.code;
    message = body.error.message || "API error";
  } else {
    message = body.message || "API error";
    code = body.code;
  }
  const upgradeUrl = body.upgradeUrl || body.upgrade_url;
  return { code, message, upgradeUrl };
}

function throwForStatus(status: number, body: ApiErrorBody): never {
  const { code, message, upgradeUrl } = parseErrorBody(body);
  if (status === 401 || status === 403) {
    throw new AuthError(message);
  }
  if (status === 429) {
    const detail =
      message === "API error" || /^429\b/.test(message)
        ? "Rate limit or quota exceeded (429 Too Many Requests). Retry with a short delay, or check your BlazeDocs quota."
        : message;
    throw new QuotaExceededError(detail, upgradeUrl);
  }
  if (status === 413) {
    const detail =
      message === "API error" || /^413\b/.test(message)
        ? "File too large (413 Request Entity Too Large). Check your plan's upload limit or try a smaller PDF."
        : `File too large: ${message}`;
    throw new ApiError(status, detail, code ?? "REQUEST_ENTITY_TOO_LARGE");
  }
  const detail = message === "API error" ? `${status} API error` : message;
  throw new ApiError(status, detail, code);
}

async function readJsonSafe(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return { message: `${response.status} ${response.statusText}` };
  }
}

export interface ConvertOptions {
  apiKey: string;
  timeoutMs?: number;
  /** Optional fetch override for testing. */
  fetchImpl?: typeof fetch;
}

export async function convertPdf(
  filePathOrUrl: string,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const { apiKey, timeoutMs = 300_000, fetchImpl = fetch } = options;
  let fileName: string;
  let fileBuffer: Buffer;

  if (filePathOrUrl.startsWith("http://") || filePathOrUrl.startsWith("https://")) {
    let response: Response;
    try {
      response = await fetchImpl(filePathOrUrl);
    } catch (e) {
      throw new NetworkError(`Failed to download PDF: ${(e as Error).message}`);
    }
    if (!response.ok) {
      throw new NetworkError(
        `Failed to download PDF from URL: ${response.status} ${response.statusText}`,
      );
    }
    fileBuffer = Buffer.from(await response.arrayBuffer());
    fileName = path.basename(new URL(filePathOrUrl).pathname) || "download.pdf";
  } else {
    const resolvedPath = path.resolve(filePathOrUrl);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    fileBuffer = fs.readFileSync(resolvedPath);
    fileName = path.basename(resolvedPath);
  }

  const formData = new FormData();
  const fileBytes = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength,
  ) as ArrayBuffer;
  formData.append("file", new File([fileBytes], fileName, { type: "application/pdf" }));

  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new NetworkError(`Network error calling API: ${(e as Error).message}`);
  }

  const parsed = (await readJsonSafe(response)) as ApiErrorBody & {
    data?: Omit<ConvertResult, "usage">;
    usage?: ConvertResult["usage"];
  };

  if (!response.ok) throwForStatus(response.status, parsed);

  if (!parsed.data || typeof parsed.data.markdown !== "string") {
    throw new ApiError(
      response.status,
      "Unexpected API response shape: missing data.markdown",
    );
  }

  return {
    markdown: parsed.data.markdown,
    page_count: parsed.data.page_count,
    token_count: parsed.data.token_count,
    processing_time_ms: parsed.data.processing_time_ms,
    file_name: parsed.data.file_name,
    usage: parsed.usage ?? { pages_used: 0, pages_limit: 0, pages_remaining: 0 },
  };
}

export async function getUsage(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageSnapshot> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}/convert`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    throw new NetworkError(`Network error calling API: ${(e as Error).message}`);
  }
  const parsed = await readJsonSafe(response);
  if (!response.ok) throwForStatus(response.status, parsed);
  return parsed as UsageSnapshot;
}

/**
 * Validate a key by calling GET /convert (usage endpoint). Returns the usage
 * snapshot on success, throws AuthError / ApiError otherwise.
 */
export async function validateApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageSnapshot> {
  return getUsage(apiKey, fetchImpl);
}
