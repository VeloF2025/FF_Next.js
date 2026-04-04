/**
 * HTTP Client Utility for Daily Audit
 * Axios wrapper with retry logic, timeout handling, and response timing
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { config } from '../config';
import { auditLogger } from './logger';

export interface HttpResult<T = any> {
  success: boolean;
  status: number;
  data: T | null;
  error: string | null;
  responseTime: number;  // ms
  headers?: Record<string, string>;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;  // ms
  retryableStatuses: number[];
}

const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

class HttpClient {
  private client: AxiosInstance;
  private retryConfig: RetryConfig;

  constructor(retryConfig: Partial<RetryConfig> = {}) {
    this.retryConfig = { ...defaultRetryConfig, ...retryConfig };

    this.client = axios.create({
      timeout: config.thresholds.api.timeoutMs,
      headers: {
        'User-Agent': 'FibreFlow-Audit/1.0',
        'Accept': 'application/json',
      },
      validateStatus: () => true,  // Don't throw on any status
    });
  }

  /**
   * Make a GET request with timing and retry logic
   */
  async get<T = any>(url: string, options: AxiosRequestConfig = {}): Promise<HttpResult<T>> {
    return this.request<T>({ ...options, method: 'GET', url });
  }

  /**
   * Make a POST request with timing and retry logic
   */
  async post<T = any>(
    url: string,
    data?: any,
    options: AxiosRequestConfig = {}
  ): Promise<HttpResult<T>> {
    return this.request<T>({ ...options, method: 'POST', url, data });
  }

  /**
   * Make a request with timing, retry logic, and error handling
   */
  private async request<T = any>(config: AxiosRequestConfig): Promise<HttpResult<T>> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let attempt = 0;


    while (attempt <= this.retryConfig.maxRetries) {
      try {
        const response = await this.client.request<T>(config);
        const responseTime = Date.now() - startTime;

        // Check if we should retry based on status
        if (
          this.retryConfig.retryableStatuses.includes(response.status) &&
          attempt < this.retryConfig.maxRetries
        ) {
          auditLogger.debug(`Retrying request to ${config.url}`, {
            status: response.status,
            attempt: attempt + 1,
          });
          attempt++;
          await this.sleep(this.retryConfig.retryDelay * attempt);
          continue;
        }

        return {
          success: response.status >= 200 && response.status < 400,
          status: response.status,
          data: response.data,
          error: response.status >= 400 ? `HTTP ${response.status}` : null,
          responseTime,
          headers: this.extractHeaders(response),
        };
      } catch (error) {
        lastError = error as Error;
        const axiosError = error as AxiosError;

        // Final attempt — log and break out
        if (attempt >= this.retryConfig.maxRetries) {
          const errCode = axiosError.code || 'UNKNOWN';
          auditLogger.warn(`${errCode}: ${config.url} (after ${attempt + 1} attempts)`);
          break;
        }

        // Retry with backoff
        attempt++;
        await this.sleep(this.retryConfig.retryDelay * attempt);
      }
    }

    const responseTime = Date.now() - startTime;
    return {
      success: false,
      status: 0,
      data: null,
      error: lastError?.message || 'Unknown error',
      responseTime,
    };
  }

  /**
   * Check if a URL is reachable (health check)
   */
  async healthCheck(url: string): Promise<HttpResult> {
    return this.get(url, { timeout: 5000 });
  }

  /**
   * Batch request multiple URLs in parallel
   */
  async batchGet<T = any>(urls: string[]): Promise<Map<string, HttpResult<T>>> {
    const results = new Map<string, HttpResult<T>>();
    const promises = urls.map(async (url) => {
      const result = await this.get<T>(url);
      results.set(url, result);
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Extract relevant headers from response
   */
  private extractHeaders(response: AxiosResponse): Record<string, string> {
    const relevantHeaders = [
      'content-type',
      'content-length',
      'x-response-time',
      'cache-control',
      'x-ratelimit-remaining',
    ];

    const headers: Record<string, string> = {};
    for (const header of relevantHeaders) {
      const value = response.headers[header];
      if (value) {
        headers[header] = String(value);
      }
    }
    return headers;
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const httpClient = new HttpClient();

// Export class for custom instances
export { HttpClient };

export default httpClient;
