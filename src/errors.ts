export class BlazeDocsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlazeDocsError";
  }
}

export class AuthError extends BlazeDocsError {
  constructor(message = "Authentication failed. Run `blazedocs login` or set BLAZEDOCS_API_KEY.") {
    super(message);
    this.name = "AuthError";
  }
}

export class QuotaExceededError extends BlazeDocsError {
  upgradeUrl?: string;
  constructor(message = "Monthly page limit reached.", upgradeUrl?: string) {
    super(message);
    this.name = "QuotaExceededError";
    this.upgradeUrl = upgradeUrl;
  }
}

export class NetworkError extends BlazeDocsError {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends BlazeDocsError {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof AuthError) return 3;
  if (err instanceof QuotaExceededError) return 2;
  return 1;
}
