/**
 * API Client for Vercel Serverless Functions
 * Handles all database operations through API routes
 */

import { log } from '@/lib/logger';

// Get the base URL for API
const getBaseUrl = () => {
  // In development, use local dev server
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:5173/api';
  }
  
  // In production, use relative path (works on same domain)
  return '/api';
};

const BASE_URL = getBaseUrl();

// Helper function to make API calls
async function apiCall<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  try {
    const url = `${BASE_URL}/${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.success === false) {
      throw new Error(data.error || 'Operation failed');
    }

    return data.data || data;
  } catch (error) {
    log.error(`API call to ${endpoint} failed`, error instanceof Error ? { message: error.message } : { error }, 'FirebaseApi');
    throw error;
  }
}

// Client API
export const clientsApi = {
  getAll: () => apiCall('clients'),
  getById: (id: string) => apiCall(`clients?id=${id}`),
  create: (data: any) => apiCall('clients', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => apiCall(`clients?id=${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => apiCall(`clients?id=${id}`, {
    method: 'DELETE',
  }),
};

// Projects API
export const projectsApi = {
  getAll: () => apiCall('projects'),
  getById: (id: string) => apiCall(`projects?id=${id}`),
  create: (data: any) => apiCall('projects', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

// Staff API
export const staffApi = {
  getAll: () => apiCall('staff'),
  getById: (id: string) => apiCall(`staff?id=${id}`),
  create: (data: any) => apiCall('staff', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

// Generic query API
export const queryApi = {
  query: (table: string, filters?: Record<string, any>, limit?: number) => 
    apiCall('query', {
      method: 'POST',
      body: JSON.stringify({ table, filters, limit }),
    }),
};

// Health check
export const healthCheck = () => apiCall('health');

// Export a unified API object
export const firebaseApi = {
  clients: clientsApi,
  projects: projectsApi,
  staff: staffApi,
  query: queryApi,
  health: healthCheck,
};