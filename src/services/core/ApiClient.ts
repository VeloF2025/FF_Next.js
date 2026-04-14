/**
 * ApiClient - HTTP client with interceptors and error handling
 * Provides consistent API communication across all services
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { auth } from '@/config/firebase';
import { log } from '@/lib/logger';

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  metadata?: {
    timestamp: string;
    requestId?: string;
    version?: string;
  };
}

class ApiClient {
  private client: AxiosInstance;
  constructor(baseURL: string = process.env.NEXT_PUBLIC_API_BASE_URL || '') {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor - Add auth token
    this.client.interceptors.request.use(
      async (config) => {
        try {
          const user = auth.currentUser;
          if (user) {
            const token = await user.getIdToken();
            config.headers.Authorization = `Bearer ${token}`;
          }
        } catch (error) {
          log.warn('Failed to get auth token:', { data: error }, 'ApiClient');
        }

        // Add request metadata
        config.headers['X-Request-ID'] = this.generateRequestId();
        config.headers['X-Client-Version'] = process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';
        
        return config;
      },
      (error) => {
        return Promise.reject(this.transformError(error));
      }
    );

    // Response interceptor - Handle errors and transform responses
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        return {
          ...response,
          data: this.transformResponse(response.data),
        };
      },
      (error) => {
        return Promise.reject(this.transformError(error));
      }
    );
  }

  private transformResponse<T>(data: T): ApiResponse<T> {
    // If already in our format, return as-is
    if (data && typeof data === 'object' && 'success' in data) {
      return data as ApiResponse<T>;
    }

    // Transform raw data to our format
    return {
      success: true,
      data,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  private transformError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const response = error.response;
      
      // Handle different error scenarios
      if (response) {
        // Server responded with error status
        return {
          message: response.data?.message || error.message,
          status: response.status,
          code: response.data?.code || `HTTP_${response.status}`,
          details: response.data,
        };
      } else if (error.request) {
        // Request made but no response received
        return {
          message: 'Network error - please check your connection',
          code: 'NETWORK_ERROR',
          details: error.request,
        };
      } else {
        // Something else happened
        return {
          message: error.message,
          code: 'REQUEST_SETUP_ERROR',
        };
      }
    }

    // Non-axios error
    if (error instanceof Error) {
      return {
        message: error.message,
        code: 'GENERIC_ERROR',
      };
    }

    return {
      message: 'An unexpected error occurred',
      code: 'UNKNOWN_ERROR',
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // HTTP Methods
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    const response = await this.client.get<ApiResponse<T>>(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    const response = await this.client.post<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    const response = await this.client.put<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    const response = await this.client.patch<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    const response = await this.client.delete<ApiResponse<T>>(url, config);
    return response.data;
  }

  // Utility methods
  setBaseURL(baseURL: string): void {
    this.client.defaults.baseURL = baseURL;
  }

  setTimeout(timeout: number): void {
    this.client.defaults.timeout = timeout;
  }

  setDefaultHeader(key: string, value: string): void {
    this.client.defaults.headers.common[key] = value;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.get('/health');
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default ApiClient;