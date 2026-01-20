/**
 * WhatsApp Admin API Service
 * Frontend service for WhatsApp Communications Admin
 */

import type {
  WaGroupConfig,
  WaGroupConfigInput,
  WaMessageTemplate,
  WaMessageTemplateInput,
  WaServiceConfig,
  WaServiceConfigInput,
  WaServicesStatusResponse,
  WaMessageLog,
  WaMessageLogFilters,
  WaAdminApiResponse,
  WaPaginatedResponse,
  WaTestMessageResult,
} from '../types/wa-admin.types';

const API_BASE = '/api/communications/whatsapp';

/**
 * Generic fetch helper with error handling
 */
async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<WaAdminApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return data;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// ============================================
// Groups API
// ============================================
export const groupsApi = {
  list: (enabled?: boolean) =>
    fetchApi<WaGroupConfig[]>(`/groups${enabled !== undefined ? `?enabled=${enabled}` : ''}`),

  get: (id: string) =>
    fetchApi<WaGroupConfig>(`/groups/${id}`),

  create: (input: WaGroupConfigInput) =>
    fetchApi<WaGroupConfig>('/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: Partial<WaGroupConfigInput>) =>
    fetchApi<WaGroupConfig>(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    fetchApi<WaGroupConfig>(`/groups/${id}`, {
      method: 'DELETE',
    }),

  test: (id: string) =>
    fetchApi<WaTestMessageResult>(`/groups/${id}/test`, {
      method: 'POST',
    }),
};

// ============================================
// Templates API
// ============================================
export const templatesApi = {
  list: (category?: string, enabled?: boolean) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (enabled !== undefined) params.set('enabled', String(enabled));
    const query = params.toString();
    return fetchApi<WaMessageTemplate[]>(`/templates${query ? `?${query}` : ''}`);
  },

  get: (key: string) =>
    fetchApi<WaMessageTemplate>(`/templates/${key}`),

  update: (key: string, input: WaMessageTemplateInput) =>
    fetchApi<WaMessageTemplate>(`/templates/${key}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  preview: (key: string, sampleData: Record<string, string>) =>
    fetchApi<{ preview: string }>(`/templates/${key}`, {
      method: 'POST',
      body: JSON.stringify(sampleData),
    }),
};

// ============================================
// Config API
// ============================================
export const configApi = {
  list: (category?: string) =>
    fetchApi<WaServiceConfig[]>(`/config${category ? `?category=${category}` : ''}`),

  get: (key: string) =>
    fetchApi<WaServiceConfig>(`/config/${key}`),

  update: (key: string, value: string) =>
    fetchApi<WaServiceConfig>(`/config/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ config_value: value } as WaServiceConfigInput),
    }),
};

// ============================================
// Services API
// ============================================
export const servicesApi = {
  status: () =>
    fetchApi<WaServicesStatusResponse>('/services/status'),

  restart: (service: 'bridge' | 'sender') =>
    fetchApi<{ service: string; success: boolean; message: string }>(`/services/${service}/restart`, {
      method: 'POST',
    }),
};

// ============================================
// Logs API
// ============================================
export const logsApi = {
  list: async (filters: WaMessageLogFilters): Promise<WaPaginatedResponse<WaMessageLog>> => {
    const params = new URLSearchParams();
    if (filters.page) params.set('page', String(filters.page));
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.direction) params.set('direction', filters.direction);
    if (filters.status) params.set('status', filters.status);
    if (filters.project) params.set('project', filters.project);
    if (filters.message_type) params.set('message_type', filters.message_type);
    if (filters.drop_number) params.set('drop_number', filters.drop_number);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);

    const response = await fetch(`${API_BASE}/logs?${params.toString()}`);
    return response.json();
  },

  exportUrl: (filters: WaMessageLogFilters): string => {
    const params = new URLSearchParams();
    if (filters.direction) params.set('direction', filters.direction);
    if (filters.status) params.set('status', filters.status);
    if (filters.project) params.set('project', filters.project);
    if (filters.message_type) params.set('message_type', filters.message_type);
    if (filters.drop_number) params.set('drop_number', filters.drop_number);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);

    return `${API_BASE}/logs/export?${params.toString()}`;
  },
};

// Combined export
export const waAdminApi = {
  groups: groupsApi,
  templates: templatesApi,
  config: configApi,
  services: servicesApi,
  logs: logsApi,
};

export default waAdminApi;
