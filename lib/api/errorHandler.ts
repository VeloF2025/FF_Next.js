/**
 * Standard API Error Handler for FibreFlow
 * 
 * Provides consistent error response structure across all API endpoints.
 * 
 * Usage:
 *   import { ApiError, handleApiError } from '@/lib/api/errorHandler';
 *   
 *   // Throw typed errors
 *   throw new ApiError('VALIDATION_ERROR', 'Invalid input', { field: 'email' });
 *   
 *   // In catch blocks
 *   catch (error) {
 *     return handleApiError(error, res);
 *   }
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'DATABASE_ERROR'
  | 'EXTERNAL_SERVICE_ERROR';

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTH_ERROR: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  SERVER_ERROR: 500,
  DATABASE_ERROR: 500,
  EXTERNAL_SERVICE_ERROR: 502,
};

export function buildErrorResponse(
  code: ErrorCode,
  message: string,
  details?: any
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
    timestamp: new Date().toISOString(),
  };
}

export function handleApiError(
  error: unknown,
  res: any // NextApiResponse
): void {
  // Handle known ApiError instances
  if (error instanceof ApiError) {
    const statusCode = error.statusCode || ERROR_STATUS_MAP[error.code];
    const response = buildErrorResponse(error.code, error.message, error.details);
    res.status(statusCode).json(response);
    return;
  }

  // Handle generic errors
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  const response = buildErrorResponse('SERVER_ERROR', message);
  res.status(500).json(response);
}

// Convenience factory functions
export const ValidationError = (message: string, details?: any) =>
  new ApiError('VALIDATION_ERROR', message, details);

export const AuthError = (message: string = 'Unauthorized') =>
  new ApiError('AUTH_ERROR', message);

export const NotFoundError = (resource: string = 'Resource') =>
  new ApiError('NOT_FOUND', `${resource} not found`);

export const ConflictError = (message: string) =>
  new ApiError('CONFLICT', message);

export const DatabaseError = (message: string = 'Database operation failed') =>
  new ApiError('DATABASE_ERROR', message);
