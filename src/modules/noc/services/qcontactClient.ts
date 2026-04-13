/**
 * QContact API Client
 * 🟢 WORKING: Production-ready HTTP client for QContact API integration
 *
 * Features:
 * - API key authentication
 * - Automatic retry with exponential backoff
 * - Request timeout handling
 * - Comprehensive error handling
 * - Request tracing with unique IDs
 * - Rate limit handling with Retry-After support
 *
 * @module maintenance/services/qcontactClient
 */

import { createLogger } from '@/lib/logger';
import type {
  QContactTicket,
  QContactAPIConfig,
} from '../types/qcontact';

// 🟢 WORKING: Logger instance for QContact client
const logger = createLogger('qcontactClient');

// ============================================================================
// Error Codes
// ============================================================================

/**
 * QContact API error codes
 * 🟢 WORKING: Comprehensive error code enumeration
 */
export enum QContactErrorCode {
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMITED = 'RATE_LIMITED',
  PARSE_ERROR = 'PARSE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * HTTP status codes that should trigger retry
 * 🟢 WORKING: Defines which errors are transient and retryable
 */
const RETRYABLE_STATUS_CODES = [500, 502, 503, 504, 429];


// ============================================================================
// Error Classes
// ============================================================================

/**
 * QContact API Error
 * 🟢 WORKING: Custom error class with rich metadata for debugging
 */
export class QContactError extends Error {
  public readonly code: QContactErrorCode;
  public readonly statusCode: number | undefined;
  public readonly requestUrl: string | undefined;
  public readonly requestMethod: string | undefined;
  public readonly isRecoverable: boolean;
  public readonly retryAfter: number | undefined;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: QContactErrorCode,
    options?: {
      statusCode?: number;
      requestUrl?: string;
      requestMethod?: string;
      isRecoverable?: boolean;
      retryAfter?: number;
      details?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'QContactError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.requestUrl = options?.requestUrl;
    this.requestMethod = options?.requestMethod;
    this.isRecoverable = options?.isRecoverable ?? false;
    this.retryAfter = options?.retryAfter;
    this.details = options?.details;

    // Capture stack trace
    Error.captureStackTrace?.(this, QContactError);
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Client options for individual requests
 */
export interface QContactClientOptions {
  throwOnNotFound?: boolean;
}

/**
 * Payload for creating a ticket in QContact
 * 🟢 WORKING: Matches QContact API requirements
 */
export interface CreateQContactTicketPayload {
  title: string;
  description?: string;
  priority?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  address?: string;
  category?: string;
  subcategory?: string;
  assigned_to?: string;
  custom_fields?: Record<string, unknown>;
}

/**
 * Payload for updating a ticket in QContact
 * 🟢 WORKING: Partial updates supported
 */
export interface UpdateQContactTicketPayload {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
  category?: string;
  subcategory?: string;
  custom_fields?: Record<string, unknown>;
}

/**
 * Payload for adding a note to a ticket
 * 🟢 WORKING: Supports internal and public notes
 */
export interface AddQContactNotePayload {
  content: string;
  author_id?: string;
  is_internal?: boolean;
}

/**
 * Note response from QContact API
 */
export interface QContactNote {
  id: string;
  ticket_id: string;
  content: string;
  author_id: string | null;
  is_internal: boolean;
  created_at: string;
}

/**
 * List tickets filter options
 */
export interface ListQContactTicketsOptions {
  status?: string;
  priority?: string;
  category?: string;
  assigned_to?: string;
  created_after?: Date;
  created_before?: Date;
  updated_after?: Date;
  updated_before?: Date;
  page?: number;
  page_size?: number;
}

/**
 * List tickets response
 * 🟢 WORKING: Paginated response format
 */
export interface QContactTicketListResponse {
  tickets: QContactTicket[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

// ============================================================================
// Internal Types
// ============================================================================

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  skipRetry?: boolean;
}

interface QContactResponse<T> {
  data?: T;
  error?: {
    message: string;
    code?: string;
    field?: string;
  };
}

// ============================================================================
// Client Class
// ============================================================================

/**
 * QContact API Client
 * 🟢 WORKING: Full-featured HTTP client for QContact integration
 *
 * @example
 * const client = createQContactClient({
 *   base_url: 'https://api.qcontact.com',
 *   api_key: 'your-api-key',
 *   timeout_ms: 10000,
 *   retry_attempts: 3,
 * });
 *
 * const ticket = await client.getTicket('QC-12345');
 */
export class QContactClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;

  constructor(config: QContactAPIConfig) {
    // 🟢 WORKING: Validate required configuration
    if (!config.base_url || config.base_url.trim() === '') {
      throw new Error('QContact API base_url is required');
    }
    if (!config.api_key || config.api_key.trim() === '') {
      throw new Error('QContact API api_key is required');
    }

    this.baseUrl = config.base_url.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.api_key;
    this.timeoutMs = config.timeout_ms || 30000; // Default 30 seconds
    this.retryAttempts = config.retry_attempts || 3; // Default 3 retries
  }

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  /**
   * Get a ticket by ID from QContact
   * 🟢 WORKING: Fetches ticket with optional silent 404 handling
   */
  async getTicket(
    ticketId: string,
    options?: QContactClientOptions
  ): Promise<QContactTicket | null> {
    try {
      const response = await this.request<QContactTicket>({
        method: 'GET',
        path: `/tickets/${ticketId}`,
      });
      return response;
    } catch (error) {
      if (
        error instanceof QContactError &&
        error.code === QContactErrorCode.NOT_FOUND &&
        options?.throwOnNotFound === false
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List tickets from QContact with filters and pagination
   * 🟢 WORKING: Supports filtering by status, date range, and pagination
   */
  async listTickets(
    options?: ListQContactTicketsOptions
  ): Promise<QContactTicketListResponse> {
    const params: Record<string, string | number | undefined> = {};

    if (options?.status) params.status = options.status;
    if (options?.priority) params.priority = options.priority;
    if (options?.category) params.category = options.category;
    if (options?.assigned_to) params.assigned_to = options.assigned_to;
    if (options?.created_after)
      params.created_after = options.created_after.toISOString();
    if (options?.created_before)
      params.created_before = options.created_before.toISOString();
    if (options?.updated_after)
      params.updated_after = options.updated_after.toISOString();
    if (options?.updated_before)
      params.updated_before = options.updated_before.toISOString();
    if (options?.page) params.page = options.page;
    if (options?.page_size) params.page_size = options.page_size;

    return this.request<QContactTicketListResponse>({
      method: 'GET',
      path: '/tickets',
      params,
    });
  }

  /**
   * Create a new ticket in QContact
   * 🟢 WORKING: Creates ticket with all provided fields
   */
  async createTicket(
    payload: CreateQContactTicketPayload
  ): Promise<QContactTicket> {
    return this.request<QContactTicket>({
      method: 'POST',
      path: '/tickets',
      body: payload,
    });
  }

  /**
   * Update a ticket in QContact
   * 🟢 WORKING: Partial updates supported
   */
  async updateTicket(
    ticketId: string,
    payload: UpdateQContactTicketPayload
  ): Promise<QContactTicket> {
    return this.request<QContactTicket>({
      method: 'PATCH',
      path: `/tickets/${ticketId}`,
      body: payload,
    });
  }

  /**
   * Add a note to a ticket in QContact
   * 🟢 WORKING: Supports internal and public notes
   */
  async addNote(
    ticketId: string,
    payload: AddQContactNotePayload
  ): Promise<QContactNote> {
    return this.request<QContactNote>({
      method: 'POST',
      path: `/tickets/${ticketId}/notes`,
      body: payload,
    });
  }

  /**
   * Check if the QContact API is healthy
   * 🟢 WORKING: Returns true if API responds, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request({
        method: 'GET',
        path: '/health',
        skipRetry: true,
      });
      return true;
    } catch (error) {
      logger.warn('QContact health check failed', { error });
      return false;
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make an HTTP request to the QContact API
   * 🟢 WORKING: Handles authentication, retries, and timeouts
   */
  private async request<T>(options: RequestOptions): Promise<T> {
    const { method, path, body, params, skipRetry } = options;
    const url = this.buildUrl(path, params);
    const requestId = this.generateRequestId();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    logger.debug('QContact API request', {
      method,
      path,
      requestId,
    });

    return this.executeWithRetry<T>(url, fetchOptions, {
      method,
      retryAttempts: skipRetry ? 0 : this.retryAttempts,
      requestId,
    });
  }

  /**
   * Execute request with retry logic and timeout
   * 🟢 WORKING: Implements exponential backoff with jitter
   */
  private async executeWithRetry<T>(
    url: string,
    fetchOptions: RequestInit,
    context: { method: string; retryAttempts: number; requestId: string }
  ): Promise<T> {
    const { method, retryAttempts, requestId } = context;
    let lastError: QContactError | undefined;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        let response: Response;
        try {
          response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
        } catch (fetchError) {
          clearTimeout(timeoutId);

          // Handle timeout (AbortError - can be Error or DOMException)
          const isAbortError =
            (fetchError instanceof Error && fetchError.name === 'AbortError') ||
            (typeof DOMException !== 'undefined' && fetchError instanceof DOMException && fetchError.name === 'AbortError');

          if (isAbortError) {
            throw new QContactError(
              `Request timeout after ${this.timeoutMs}ms`,
              QContactErrorCode.TIMEOUT,
              {
                requestUrl: url,
                requestMethod: method,
                isRecoverable: true,
              }
            );
          }

          // Handle network errors
          throw new QContactError(
            `Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
            QContactErrorCode.NETWORK_ERROR,
            {
              requestUrl: url,
              requestMethod: method,
              isRecoverable: true,
            }
          );
        }

        // Handle response
        return await this.handleResponse<T>(response, url, method);
      } catch (error) {
        // Check if it's already a QContactError (by duck typing for robustness)
        const isQContactError =
          error instanceof QContactError ||
          (error instanceof Error &&
            'code' in error &&
            Object.values(QContactErrorCode).includes((error as Record<string, unknown>).code as QContactErrorCode));

        if (!isQContactError) {
          // Wrap unexpected errors
          throw new QContactError(
            `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            QContactErrorCode.UNKNOWN_ERROR,
            {
              requestUrl: url,
              requestMethod: method,
              isRecoverable: false,
            }
          );
        }

        lastError = error as QContactError;

        // Don't retry if not recoverable or no more attempts
        if (!error.isRecoverable || attempt >= retryAttempts) {
          throw error;
        }

        // Calculate backoff delay with exponential backoff
        // In test environment, use minimal delays
        const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;
        const baseDelay = error.retryAfter
          ? error.retryAfter * 1000
          : isTest
            ? 10 // 10ms in tests
            : Math.pow(2, attempt) * 1000;

        // Add jitter (10-20% of base delay)
        const jitter = isTest ? 0 : baseDelay * (0.1 + Math.random() * 0.1);
        const delay = baseDelay + jitter;

        logger.debug('Retrying QContact request', {
          attempt: attempt + 1,
          maxAttempts: retryAttempts + 1,
          delay,
          requestId,
          error: error.message,
        });

        await this.sleep(delay);
      }
    }

    throw (
      lastError ||
      new QContactError(
        'Request failed after all retry attempts',
        QContactErrorCode.UNKNOWN_ERROR,
        { requestUrl: url, requestMethod: method }
      )
    );
  }

  /**
   * Handle API response
   * 🟢 WORKING: Parses response and throws appropriate errors
   */
  private async handleResponse<T>(
    response: Response,
    url: string,
    method: string
  ): Promise<T> {
    // Defensive check for response object
    if (!response || typeof response.status !== 'number') {
      throw new QContactError(
        'Invalid response received',
        QContactErrorCode.NETWORK_ERROR,
        {
          requestUrl: url,
          requestMethod: method,
          isRecoverable: true,
        }
      );
    }

    const statusCode = response.status;
    const isOk = response.ok;

    // Try to parse JSON response
    let data: QContactResponse<T>;
    try {
      data = await response.json();
    } catch (parseError) {
      // If response is not OK and can't parse JSON, throw parse error
      if (!isOk) {
        throw new QContactError(
          'Failed to parse API response',
          QContactErrorCode.PARSE_ERROR,
          {
            statusCode,
            requestUrl: url,
            requestMethod: method,
            isRecoverable: false,
          }
        );
      }
      // If response is OK but can't parse, might be empty response
      return {} as T;
    }

    // Handle successful response
    if (isOk) {
      return data.data as T;
    }

    // Handle error response
    const errorMessage = data?.error?.message || `HTTP ${statusCode} error`;
    const errorCode = this.mapStatusCodeToErrorCode(statusCode);
    const isRecoverable = RETRYABLE_STATUS_CODES.includes(statusCode);

    // Parse Retry-After header for rate limiting
    let retryAfter: number | undefined;
    if (statusCode === 429) {
      try {
        const retryAfterHeader = response.headers?.get?.('Retry-After');
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10);
        }
      } catch {
        // Ignore header parsing errors
      }
    }

    throw new QContactError(errorMessage, errorCode, {
      statusCode,
      requestUrl: url,
      requestMethod: method,
      isRecoverable,
      retryAfter,
      details: data?.error as Record<string, unknown>,
    });
  }

  /**
   * Map HTTP status code to QContact error code
   * 🟢 WORKING: Comprehensive status code mapping
   */
  private mapStatusCodeToErrorCode(statusCode: number): QContactErrorCode {
    switch (statusCode) {
      case 400:
        return QContactErrorCode.VALIDATION_ERROR;
      case 401:
        return QContactErrorCode.AUTHENTICATION_ERROR;
      case 403:
        return QContactErrorCode.AUTHORIZATION_ERROR;
      case 404:
        return QContactErrorCode.NOT_FOUND;
      case 422:
        return QContactErrorCode.VALIDATION_ERROR;
      case 429:
        return QContactErrorCode.RATE_LIMITED;
      case 500:
      case 502:
      case 503:
      case 504:
        return QContactErrorCode.SERVER_ERROR;
      default:
        return QContactErrorCode.UNKNOWN_ERROR;
    }
  }

  /**
   * Build URL with query parameters
   * 🟢 WORKING: Handles undefined values and encoding
   */
  private buildUrl(
    path: string,
    params?: Record<string, string | number | undefined>
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Generate unique request ID for tracing
   * 🟢 WORKING: Format: req_{timestamp}_{random}
   */
  private generateRequestId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `req_${timestamp}_${random}`;
  }

  /**
   * Sleep for specified milliseconds
   * 🟢 WORKING: Promise-based delay for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a QContact API client instance
 * 🟢 WORKING: Validates configuration and creates client
 *
 * @param config - QContact API configuration
 * @returns Configured QContact client instance
 *
 * @example
 * const client = createQContactClient({
 *   base_url: process.env.FIBERTIME_QCONTACT_BASE_URL!,
 *   api_key: process.env.FIBERTIME_QCONTACT_ACCESS_TOKEN!,
 *   timeout_ms: 10000,
 *   retry_attempts: 3,
 * });
 */
export function createQContactClient(config: QContactAPIConfig): QContactClient {
  return new QContactClient(config);
}

// ============================================================================
// Singleton Instance (Optional)
// ============================================================================

/**
 * Get the default QContact client instance
 * 🟢 WORKING: Lazily creates singleton from environment variables
 */
let defaultClient: QContactClient | null = null;

export function getDefaultQContactClient(): QContactClient {
  if (!defaultClient) {
    const config: QContactAPIConfig = {
      // Support both FIBERTIME_QCONTACT_* (current) and QCONTACT_* (legacy) env vars
      base_url: process.env.FIBERTIME_QCONTACT_BASE_URL || process.env.QCONTACT_API_URL || '',
      api_key: process.env.FIBERTIME_QCONTACT_ACCESS_TOKEN || process.env.QCONTACT_API_KEY || '',
      timeout_ms: parseInt(process.env.QCONTACT_TIMEOUT_MS || '30000', 10),
      retry_attempts: parseInt(process.env.QCONTACT_RETRY_ATTEMPTS || '3', 10),
    };

    defaultClient = createQContactClient(config);
  }

  return defaultClient;
}

/**
 * Reset the default client (for testing)
 * 🟢 WORKING: Clears singleton for test isolation
 */
export function resetDefaultQContactClient(): void {
  defaultClient = null;
}
