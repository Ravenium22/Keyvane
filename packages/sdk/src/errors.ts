export interface KeyvaneErrorDetails {
  status?: number;
  type?: string;
  code?: string;
  param?: string;
  requestId?: string;
  cause?: unknown;
}

/** Base class for every error thrown by the SDK. */
export class KeyvaneError extends Error {
  /** HTTP status, when the API answered. */
  readonly status: number | undefined;
  /** API error type, e.g. `invalid_request_error`. */
  readonly type: string | undefined;
  /** Machine-readable code, e.g. `feature_not_found`. */
  readonly code: string | undefined;
  /** The request parameter the error is about, if any. */
  readonly param: string | undefined;
  /** `X-Request-Id` of the failed request — include it when asking for support. */
  readonly requestId: string | undefined;

  constructor(message: string, details: KeyvaneErrorDetails = {}) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = 'KeyvaneError';
    this.status = details.status;
    this.type = details.type;
    this.code = details.code;
    this.param = details.param;
    this.requestId = details.requestId;
  }
}

/** 400 — something is wrong with the request (missing or invalid parameter). */
export class KeyvaneInvalidRequestError extends KeyvaneError {
  override name = 'KeyvaneInvalidRequestError';
}
/** 401 — the API key is missing, wrong or revoked. */
export class KeyvaneAuthenticationError extends KeyvaneError {
  override name = 'KeyvaneAuthenticationError';
}
/** 403 — e.g. a publishable key was used for a secret-key endpoint. */
export class KeyvanePermissionError extends KeyvaneError {
  override name = 'KeyvanePermissionError';
}
/** 404 — the customer, license, product, plan or feature does not exist. */
export class KeyvaneNotFoundError extends KeyvaneError {
  override name = 'KeyvaneNotFoundError';
}
/** 409 — the request conflicts with the current state (e.g. reinstating a revoked license). */
export class KeyvaneConflictError extends KeyvaneError {
  override name = 'KeyvaneConflictError';
}
/** 429 — too many requests. */
export class KeyvaneRateLimitError extends KeyvaneError {
  override name = 'KeyvaneRateLimitError';
}
/** 5xx — Keyvane had a problem. Safe requests are retried automatically first. */
export class KeyvaneApiError extends KeyvaneError {
  override name = 'KeyvaneApiError';
}
/** The API could not be reached (network error or timeout). */
export class KeyvaneConnectionError extends KeyvaneError {
  override name = 'KeyvaneConnectionError';
}

export function errorFromResponse(status: number, body: unknown, requestId: string | undefined): KeyvaneError {
  const err = (body && typeof body === 'object' && 'error' in body ? (body as { error: Record<string, unknown> }).error : {}) ?? {};
  const message = typeof err.message === 'string' ? err.message : `Keyvane API responded with HTTP ${status}.`;
  const details: KeyvaneErrorDetails = {
    status,
    type: typeof err.type === 'string' ? err.type : undefined,
    code: typeof err.code === 'string' ? err.code : undefined,
    param: typeof err.param === 'string' ? err.param : undefined,
    requestId,
  };
  switch (status) {
    case 400:
    case 413:
      return new KeyvaneInvalidRequestError(message, details);
    case 401:
      return new KeyvaneAuthenticationError(message, details);
    case 403:
      return new KeyvanePermissionError(message, details);
    case 404:
      return new KeyvaneNotFoundError(message, details);
    case 409:
      return new KeyvaneConflictError(message, details);
    case 429:
      return new KeyvaneRateLimitError(message, details);
    default:
      return status >= 500 ? new KeyvaneApiError(message, details) : new KeyvaneError(message, details);
  }
}
