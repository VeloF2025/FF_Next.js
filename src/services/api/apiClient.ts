/**
 * Universal API Client
 * Handles all API calls to prevent direct database access from browser
 */

const API_BASE = '/api';

/** Generic record type for API request bodies — callers with known shapes use their own type. */
type ApiPayload = Record<string, unknown>;

/** Generic record type for query filters */
type QueryFilters = Record<string, unknown>;

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data || data;
}

// Generic API client for all entities
export const apiClient = {
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_BASE}/${endpoint}`);
    return handleResponse<T>(response);
  },

  async post<T>(endpoint: string, data: ApiPayload): Promise<T> {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<T>(response);
  },

  async put<T>(endpoint: string, data: ApiPayload): Promise<T> {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<T>(response);
  },

  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'DELETE'
    });
    return handleResponse<T>(response);
  }
};

// Service-specific API clients
export const clientsApi = {
  getAll: () => apiClient.get<ApiPayload[]>('clients'),
  getById: (id: string) => apiClient.get<ApiPayload>(`clients?id=${id}`),
  create: (data: ApiPayload) => apiClient.post<ApiPayload>('clients', data),
  update: (id: string, data: ApiPayload) => apiClient.put<ApiPayload>(`clients?id=${id}`, data),
  delete: (id: string) => apiClient.delete<ApiPayload>(`clients?id=${id}`)
};

export const projectsApi = {
  getAll: () => apiClient.get<ApiPayload[]>('projects'),
  getById: (id: string) => apiClient.get<ApiPayload>(`projects?id=${id}`),
  create: (data: ApiPayload) => apiClient.post<ApiPayload>('projects', data),
  update: (id: string, data: ApiPayload) => apiClient.put<ApiPayload>(`projects?id=${id}`, data),
  delete: (id: string) => apiClient.delete<ApiPayload>(`projects?id=${id}`)
};

export const staffApi = {
  getAll: () => apiClient.get<ApiPayload[]>('staff'),
  getById: (id: string) => apiClient.get<ApiPayload>(`staff?id=${id}`),
  create: (data: ApiPayload) => apiClient.post<ApiPayload>('staff', data),
  update: (id: string, data: ApiPayload) => apiClient.put<ApiPayload>(`staff?id=${id}`, data),
  delete: (id: string) => apiClient.delete<ApiPayload>(`staff?id=${id}`)
};

export const queryApi = {
  query: (table: string, filters?: QueryFilters, limit?: number) =>
    apiClient.post<ApiPayload[]>('query', { table, filters: filters ?? {}, limit })
};
