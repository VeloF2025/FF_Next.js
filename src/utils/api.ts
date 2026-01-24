import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { ApiResponse, ApiError } from '@/types'

// Create axios instance with default configuration
const api: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor for handling errors
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error) => {
    const apiError: ApiError = {
      message: error.response?.data?.message || 'An unexpected error occurred',
      code: error.response?.data?.code,
      statusCode: error.response?.status,
    }

    // Handle specific error codes
    if (error.response?.status === 401) {
      // Handle unauthorized - redirect to sign-in with return URL
      localStorage.removeItem('auth_token')
      if (typeof window !== 'undefined') {
        const currentPath = window.location.pathname + window.location.search
        // Don't redirect if already on sign-in page
        if (!currentPath.startsWith('/sign-in')) {
          window.location.href = `/sign-in?returnUrl=${encodeURIComponent(currentPath)}`
        }
      }
    }

    return Promise.reject(apiError)
  }
)

// Generic API methods
export const apiClient = {
  get: <T>(url: string): Promise<ApiResponse<T>> =>
    api.get(url).then((response) => response.data),

  post: <T>(url: string, data?: unknown): Promise<ApiResponse<T>> =>
    api.post(url, data).then((response) => response.data),

  put: <T>(url: string, data?: unknown): Promise<ApiResponse<T>> =>
    api.put(url, data).then((response) => response.data),

  patch: <T>(url: string, data?: unknown): Promise<ApiResponse<T>> =>
    api.patch(url, data).then((response) => response.data),

  delete: <T>(url: string): Promise<ApiResponse<T>> =>
    api.delete(url).then((response) => response.data),
}

export default api