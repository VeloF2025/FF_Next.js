/**
 * Unified API Response Format
 * 
 * All API endpoints should use these helpers to return consistent response shapes.
 * 
 * Committee Decision: IMPLEMENT (Feb 23, 2026)
 * Migration Plan: docs/API-ERROR-RESPONSE-MIGRATION.md
 */

import { v4 as uuid } from 'uuid';

export interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  data: null;
  error: string;
  code?: string;
  statusCode: number;
  timestamp: string;
  requestId: string;
}

export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  return uuid();
}

/**
 * Build a success response
 * 
 * @param data Response payload
 * @param meta Optional metadata (requestId, timestamp override, etc.)
 * @returns Success response object
 * 
 * @example
 * ```typescript
 * const users = await db.users.findAll();
 * return res.status(200).json(successResponse(users));
 * ```
 */
export function successResponse<T>(
  data: T,
  meta?: { requestId?: string; timestamp?: string }
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: meta?.timestamp || new Date().toISOString(),
    requestId: meta?.requestId || generateRequestId(),
  };
}

/**
 * Build an error response
 * 
 * @param error User-facing error message
 * @param code Optional programmatic error code (e.g., 'VALIDATION_ERROR')
 * @param statusCode HTTP status code
 * @param meta Optional metadata (requestId, timestamp override, etc.)
 * @returns Error response object
 * 
 * @example
 * ```typescript
 * try {
 *   const user = await db.users.findById(id);
 *   if (!user) {
 *     return res.status(404).json(errorResponse(
 *       'User not found',
 *       'NOT_FOUND',
 *       404
 *     ));
 *   }
 * } catch (err) {
 *   return res.status(500).json(errorResponse(
 *     'Internal server error',
 *     'INTERNAL_SERVER_ERROR',
 *     500
 *   ));
 * }
 * ```
 */
export function errorResponse(
  error: string,
  code?: string,
  statusCode: number = 500,
  meta?: { requestId?: string; timestamp?: string }
): ApiErrorResponse {
  return {
    success: false,
    data: null,
    error,
    code,
    statusCode,
    timestamp: meta?.timestamp || new Date().toISOString(),
    requestId: meta?.requestId || generateRequestId(),
  };
}

/**
 * Standard HTTP error helpers
 * 
 * @example
 * ```typescript
 * if (!input.email) {
 *   return res.status(400).json(HttpErrors.BadRequest('Email is required'));
 * }
 * ```
 */
export const HttpErrors = {
  BadRequest: (message = 'Bad Request', code = 'BAD_REQUEST') =>
    errorResponse(message, code, 400),

  Unauthorized: (message = 'Unauthorized', code = 'UNAUTHORIZED') =>
    errorResponse(message, code, 401),

  Forbidden: (message = 'Forbidden', code = 'FORBIDDEN') =>
    errorResponse(message, code, 403),

  NotFound: (message = 'Not Found', code = 'NOT_FOUND') =>
    errorResponse(message, code, 404),

  MethodNotAllowed: (method: string, code = 'METHOD_NOT_ALLOWED') =>
    errorResponse(`Method ${method} not allowed`, code, 405),

  Conflict: (message = 'Conflict', code = 'CONFLICT') =>
    errorResponse(message, code, 409),

  ValidationError: (message = 'Validation Error', code = 'VALIDATION_ERROR') =>
    errorResponse(message, code, 422),

  InternalServerError: (message = 'Internal Server Error', code = 'INTERNAL_SERVER_ERROR') =>
    errorResponse(message, code, 500),

  DatabaseError: (message = 'Database operation failed', code = 'DATABASE_ERROR') =>
    errorResponse(message, code, 500),

  ServiceUnavailable: (message = 'Service Unavailable', code = 'SERVICE_UNAVAILABLE') =>
    errorResponse(message, code, 503),
};

/**
 * Middleware-safe wrapper for API handlers
 * Ensures all responses use the unified format
 * 
 * @example
 * ```typescript
 * export default withErrorHandler(async (req, res) => {
 *   const user = await db.users.findById(req.query.id);
 *   if (!user) {
 *     return res.status(404).json(HttpErrors.NotFound('User not found'));
 *   }
 *   res.status(200).json(successResponse(user));
 * });
 * ```
 */
export function withErrorHandler(
  handler: (req: any, res: any) => Promise<void> | void
) {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      const message = err?.message || 'An unexpected error occurred';
      const code = err?.code || 'INTERNAL_SERVER_ERROR';
      const statusCode = err?.statusCode || 500;

      res.status(statusCode).json(
        errorResponse(message, code, statusCode)
      );
    }
  };
}

/**
 * Type guard to check if response is an error
 * 
 * @example
 * ```typescript
 * const response = await fetch(...);
 * const data = await response.json();
 * if (isErrorResponse(data)) {
 *   console.error(data.error);
 * }
 * ```
 */
export function isErrorResponse(response: any): response is ApiErrorResponse {
  return response?.success === false && response?.data === null;
}

/**
 * Type guard to check if response is a success
 */
export function isSuccessResponse<T>(response: any): response is ApiSuccessResponse<T> {
  return response?.success === true && 'data' in response;
}
