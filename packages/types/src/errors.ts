/** Error taxonomy + the Result pattern used for every fallible operation. */

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_MODALITY'
  | 'FILE_TOO_LARGE'
  | 'CLASSIFICATION_FAILED'
  | 'ENHANCEMENT_FAILED'
  | 'DECOMPOSITION_FAILED'
  | 'PLANNING_FAILED'
  | 'NO_PROVIDERS_AVAILABLE'
  | 'ALL_PROVIDERS_FAILED'
  | 'RATE_LIMIT_GLOBAL'
  | 'QUOTA_EXCEEDED'
  | 'TASK_NOT_FOUND'
  | 'TIMEOUT'
  | 'PROMPT_INJECTION'
  | 'VERIFICATION_FAILED'
  | 'AGGREGATION_FAILED'
  | 'PERSISTENCE_ERROR'
  | 'UNAUTHORIZED'
  | 'INTERNAL';

export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E; code: ErrorCode };

export const ok = <T>(data: T): Result<T, never> => ({ success: true, data });

export const err = <E extends Error = Error>(
  code: ErrorCode,
  error: E | string,
): Result<never, E> => ({
  success: false,
  code,
  error: (typeof error === 'string' ? new Error(error) : error) as E,
});

/** HTTP status for each error code (docs/04-API-SPEC.md). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNSUPPORTED_MODALITY: 400,
  FILE_TOO_LARGE: 413,
  CLASSIFICATION_FAILED: 500,
  ENHANCEMENT_FAILED: 500,
  DECOMPOSITION_FAILED: 500,
  PLANNING_FAILED: 500,
  NO_PROVIDERS_AVAILABLE: 503,
  ALL_PROVIDERS_FAILED: 503,
  RATE_LIMIT_GLOBAL: 429,
  QUOTA_EXCEEDED: 429,
  TASK_NOT_FOUND: 404,
  TIMEOUT: 408,
  PROMPT_INJECTION: 400,
  VERIFICATION_FAILED: 500,
  AGGREGATION_FAILED: 500,
  PERSISTENCE_ERROR: 500,
  UNAUTHORIZED: 401,
  INTERNAL: 500,
};
