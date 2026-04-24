import * as fs from "fs";
import * as path from "path";
import { AuthError, QuotaExceededError, NetworkError, ApiError } from "./errors.js";

export const API_BASE =
  process.env.BLAZEDOCS_API_URL || "https://blazedocs.io/api/v1";

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
    throw new QuotaExceededError(message, upgradeUrl);
  }
  throw new ApiError(status, message, code);
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

  const jsonBody = {
    file_base64: fileBuffer.toString("base64"),
    file_name: fileName,
  };

  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}/convert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonBody),
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
