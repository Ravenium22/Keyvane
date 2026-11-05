export type ErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'conflict_error'
  | 'rate_limit_error'
  | 'api_error';

/**
 * An error that is safe to show to the caller. Services throw these; the API layer
 * renders them as JSON and the dashboard renders them as form errors.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly type: ErrorType;
  readonly code: string;
  readonly param: string | undefined;

  constructor(status: number, type: ErrorType, code: string, message: string, param?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = param;
  }

  toJSON() {
    return {
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        ...(this.param ? { param: this.param } : {}),
      },
    };
  }
}

export const badRequest = (code: string, message: string, param?: string) =>
  new ApiError(400, 'invalid_request_error', code, message, param);

export const notFound = (resource: string, code = 'resource_missing') =>
  new ApiError(404, 'not_found_error', code, `${resource} not found.`);

export const conflict = (code: string, message: string, param?: string) =>
  new ApiError(409, 'conflict_error', code, message, param);

export const unauthorized = (message = 'Invalid or missing API key.') =>
  new ApiError(401, 'authentication_error', 'invalid_api_key', message);

export const forbidden = (code: string, message: string) => new ApiError(403, 'permission_error', code, message);

export const tooManyRequests = (message = 'Too many requests. Please slow down.') =>
  new ApiError(429, 'rate_limit_error', 'rate_limited', message);
