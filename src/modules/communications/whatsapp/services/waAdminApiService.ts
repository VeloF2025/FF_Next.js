/**
 * WhatsApp Admin API Service
 * Frontend service for WhatsApp Communications Admin
 */

import type {
  WaMonitoredGroup,
  WaMonitoredGroupInput,
  WaGroupType,
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
  WaPhoneNumber,
  WaPhoneNumberInput,
  WaSendMessageInput,
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
      const errorMsg = typeof data.error === 'string'
        ? data.error
        : (data.error?.message || `HTTP ${response.status}`);
      return {
        success: false,
        error: errorMsg,
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
// Monitored Groups API (Bridge Configuration)
// ============================================
export const monitoredGroupsApi = {
  list: (groupType?: WaGroupType, isActive?: boolean) => {
    const params = new URLSearchParams();
    if (groupType) params.set('group_type', groupType);
    if (isActive !== undefined) params.set('is_active', String(isActive));
    const query = params.toString();
    return fetchApi<WaMonitoredGroup[]>(`/monitored-groups${query ? `?${query}` : ''}`);
  },

  get: (id: string) =>
    fetchApi<WaMonitoredGroup>(`/monitored-groups/${id}`),

  create: (input: WaMonitoredGroupInput) =>
    fetchApi<WaMonitoredGroup>('/monitored-groups', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: Partial<WaMonitoredGroupInput>) =>
    fetchApi<WaMonitoredGroup>(`/monitored-groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    fetchApi<WaMonitoredGroup>(`/monitored-groups/${id}`, {
      method: 'DELETE',
    }),
};

// ============================================
// Groups API (uses wa_monitored_groups - same as unified bridge)
// ============================================
export const groupsApi = {
  list: (isActive?: boolean, groupType?: WaGroupType) => {
    const params = new URLSearchParams();
    if (isActive !== undefined) params.set('is_active', String(isActive));
    if (groupType) params.set('group_type', groupType);
    const query = params.toString();
    return fetchApi<WaMonitoredGroup[]>(`/groups${query ? `?${query}` : ''}`);
  },

  get: (id: string) =>
    fetchApi<WaMonitoredGroup>(`/groups/${id}`),

  create: (input: WaMonitoredGroupInput) =>
    fetchApi<WaMonitoredGroup>('/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: Partial<WaMonitoredGroupInput>) =>
    fetchApi<WaMonitoredGroup>(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    fetchApi<WaMonitoredGroup>(`/groups/${id}`, {
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
// Pairing Response Types
// ============================================
interface PairResponse {
  success: boolean;
  pairing_code?: string;
  phone_number?: string;
  expires_at?: string;
  instructions?: string[];
  error?: string;
}

interface PairingStatusResponse {
  service: 'bridge' | 'sender';
  status: 'idle' | 'generating' | 'waiting' | 'connected' | 'failed' | 'expired';
  pairing_code: string | null;
  expires_at: string | null;
  error_message: string | null;
  connected: boolean;
  session_valid: boolean;
  phone_number: string;
}

interface LogoutResponse {
  success: boolean;
  message: string;
}

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

  /**
   * Initiate pairing process for a service
   * Returns pairing code to enter on the phone
   */
  pair: (service: 'bridge' | 'sender', phoneNumber?: string) =>
    fetchApi<PairResponse>(`/services/${service}/pair`, {
      method: 'POST',
      body: JSON.stringify({ phone_number: phoneNumber }),
    }),

  /**
   * Get current pairing status
   * Poll this after initiating pairing to check completion
   */
  pairingStatus: (service: 'bridge' | 'sender') =>
    fetchApi<PairingStatusResponse>(`/services/${service}/pairing-status`),

  /**
   * Logout and clear session
   * Service will require re-pairing after this
   */
  logout: (service: 'bridge' | 'sender') =>
    fetchApi<LogoutResponse>(`/services/${service}/logout`, {
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

// ============================================
// Messages API (Send Custom Messages)
// ============================================
export const messagesApi = {
  send: (input: WaSendMessageInput) =>
    fetchApi<WaTestMessageResult>('/send-message', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

// ============================================
// Phones API (Multi-service Support)
// ============================================
export const phonesApi = {
  list: (service?: 'bridge' | 'sender') =>
    fetchApi<WaPhoneNumber[]>(`/phones${service ? `?service=${service}` : ''}`),

  get: (id: string) =>
    fetchApi<WaPhoneNumber>(`/phones/${id}`),

  create: (input: WaPhoneNumberInput) =>
    fetchApi<WaPhoneNumber>('/phones', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: Partial<WaPhoneNumberInput & { status: string }>) =>
    fetchApi<WaPhoneNumber>(`/phones/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    fetchApi<WaPhoneNumber>(`/phones/${id}`, {
      method: 'DELETE',
    }),

  /**
   * Set a phone as primary (will demote current primary to fallback)
   */
  setPrimary: (id: string) =>
    fetchApi<WaPhoneNumber>(`/phones/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'primary' }),
    }),
};

// Combined export
export const waAdminApi = {
  monitoredGroups: monitoredGroupsApi,
  groups: groupsApi,
  templates: templatesApi,
  config: configApi,
  services: servicesApi,
  logs: logsApi,
  messages: messagesApi,
  phones: phonesApi,
};

export default waAdminApi;
