/**
 * BaseService - Foundation class for all application services
 * Provides common functionality: error handling, logging, caching
 */

import { log } from '@/lib/logger';

interface FirebaseError extends Error {
  code: string;
}

export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface ServiceOptions {
  timeout?: number;
  retries?: number;
  cache?: boolean;
  cacheTTL?: number;
}

export abstract class BaseService {
  protected serviceName: string;
  protected defaultOptions: ServiceOptions;

  constructor(serviceName: string, options: ServiceOptions = {}) {
    this.serviceName = serviceName;
    this.defaultOptions = {
      timeout: 30000,
      retries: 3,
      cache: false,
      cacheTTL: 300000, // 5 minutes
      ...options,
    };
  }

  /**
   * Standardized error handling for all services
   */
  public handleError(error: unknown, operation: string): ServiceResponse<never> {
    log.error(`[${this.serviceName}] Error in ${operation}:`, { data: error }, 'BaseService');

    if (error instanceof Error && 'code' in error) {
      return {
        success: false,
        error: this.mapFirebaseError(error as FirebaseError),
        code: (error as FirebaseError).code,
      };
    }

    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
        code: 'GENERIC_ERROR',
      };
    }

    return {
      success: false,
      error: 'An unexpected error occurred',
      code: 'UNKNOWN_ERROR',
    };
  }

  /**
   * Map Firebase errors to user-friendly messages
   */
  private mapFirebaseError(error: FirebaseError): string {
    const errorMap: Record<string, string> = {
      'auth/user-not-found': 'User not found',
      'auth/wrong-password': 'Invalid password',
      'auth/invalid-email': 'Invalid email address',
      'auth/user-disabled': 'Account has been disabled',
      'auth/too-many-requests': 'Too many attempts. Please try again later',
      'permission-denied': 'You do not have permission to perform this action',
      'not-found': 'The requested resource was not found',
      'already-exists': 'This resource already exists',
      'resource-exhausted': 'Service quota exceeded',
      'unavailable': 'Service temporarily unavailable',
    };

    return errorMap[error.code] || `Firebase error: ${error.message}`;
  }

  /**
   * Standardized success response wrapper
   */
  public success<T>(data: T): ServiceResponse<T> {
    return {
      success: true,
      data,
    };
  }

  /**
   * Retry mechanism for operations
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    retries: number = this.defaultOptions.retries!,
    delay: number = 1000
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.withRetry(operation, retries - 1, delay * 2);
      }
      throw error;
    }
  }

  /**
   * Timeout wrapper for operations
   */
  protected async withTimeout<T>(
    operation: () => Promise<T>,
    timeout: number = this.defaultOptions.timeout!
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);

      operation()
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  }

  /**
   * Get service health status
   */
  abstract getHealthStatus(): Promise<ServiceResponse<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: Record<string, unknown>;
  }>>;
}

export default BaseService;