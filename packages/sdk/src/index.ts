/**
 * @keyvane/sdk — licenses, entitlements and usage limits for indie software.
 * https://github.com/Ravenium22/Keyvane · MIT License
 */
export { Keyvane, LicenseValidation, VERSION } from './client.ts';
export type { CreateLicenseParams, CustomerParams, KeyvaneOptions, RecordUsageParams } from './client.ts';
export { Entitlements } from './entitlements.ts';
export {
  KeyvaneApiError,
  KeyvaneAuthenticationError,
  KeyvaneConflictError,
  KeyvaneConnectionError,
  KeyvaneError,
  KeyvaneInvalidRequestError,
  KeyvaneNotFoundError,
  KeyvanePermissionError,
  KeyvaneRateLimitError,
} from './errors.ts';
export type * from './types.ts';
