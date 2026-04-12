/**
 * Error Handler Types
 * Type definitions for error handling and logging
 */

import type React from 'react';

/**
 * Standard error response format for API operations
 */
export interface ErrorResponse {
  success: false;
  error: {
    name: string;
    message: string;
    code: string;
    statusCode: number;
    timestamp: string;
    context?: Record<string, unknown>;
    userMessage?: string;
    [key: string]: unknown; // Allow for specific error properties
  };
  statusCode: number;
}

/**
 * Error logging context information
 */
export interface ErrorLogContext {
  userId?: string;
  projectId?: string;
  operation?: string;
  requestId?: string;
  userAgent?: string;
  ipAddress?: string;
  additionalInfo?: Record<string, unknown>;
}

/**
 * Error aggregation result for batch operations
 */
export interface ErrorAggregationResult {
  hasErrors: boolean;
  errorSummary: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  detailedErrors: Array<{
    item: unknown;
    error: ErrorResponse['error'];
  }>;
}

/**
 * Batch operation error item
 */
export interface BatchErrorItem {
  item: unknown;
  error: unknown;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
}

/**
 * Error boundary configuration
 */
export interface ErrorBoundaryConfig {
  fallbackComponent: React.ComponentType<unknown>;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  displayName?: string;
}

/**
 * Error severity levels
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * User-friendly message mapping
 */
export interface UserFriendlyMessages {
  [errorCode: string]: string;
}

/**
 * Error logging interface
 */
export interface IErrorLogger {
  log(error: unknown, context: ErrorLogContext): void;
  logCritical(error: unknown, context: ErrorLogContext): void;
  logHigh(error: unknown, context: ErrorLogContext): void;
  logMedium(error: unknown, context: ErrorLogContext): void;
  logLow(error: unknown, context: ErrorLogContext): void;
}

/**
 * Error handler interface
 */
export interface IErrorHandler {
  handleError(error: unknown): ErrorResponse;
  handleErrorWithContext(error: unknown, context: ErrorLogContext): ErrorResponse;
  createValidationError(field: string, message: string, value?: unknown): unknown;
  createNotFoundError(resourceType: string, resourceId: string, context?: Record<string, unknown>): unknown;
}

/**
 * Error aggregator interface
 */
export interface IErrorAggregator {
  aggregateErrors(errors: BatchErrorItem[]): ErrorAggregationResult;
  summarizeErrors(errors: unknown[]): { total: number; byType: Record<string, number> };
}

/**
 * Retry service interface
 */
export interface IRetryService {
  retryOnError<T>(operation: () => Promise<T>, config?: RetryConfig): Promise<T>;
  isRetryableError(error: unknown): boolean;
}