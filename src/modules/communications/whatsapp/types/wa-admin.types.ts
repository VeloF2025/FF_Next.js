/**
 * WhatsApp Communications Admin Types
 */

// ============================================
// Group Configuration
// ============================================
export interface WaGroupConfig {
  id: string;
  project_name: string;
  group_jid: string;
  group_name: string | null;
  phone_number: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WaGroupConfigInput {
  project_name: string;
  group_jid: string;
  group_name?: string;
  phone_number?: string;
  enabled?: boolean;
}

// ============================================
// Message Templates
// ============================================
export interface WaMessageTemplate {
  id: string;
  template_key: string;
  template_name: string;
  template_content: string;
  variables: string[];
  category: 'acknowledgment' | 'feedback' | 'notification' | 'system' | 'general';
  enabled: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface WaMessageTemplateInput {
  template_name?: string;
  template_content: string;
  variables?: string[];
  category?: WaMessageTemplate['category'];
  enabled?: boolean;
}

// ============================================
// Message Logs
// ============================================
export interface WaMessageLog {
  id: string;
  direction: 'inbound' | 'outbound';
  service: 'bridge' | 'sender';
  message_type: string | null;
  group_jid: string | null;
  recipient_jid: string | null;
  sender_jid: string | null;
  message_content: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  error_message: string | null;
  drop_number: string | null;
  project: string | null;
  template_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WaMessageLogFilters {
  direction?: 'inbound' | 'outbound';
  status?: WaMessageLog['status'];
  project?: string;
  message_type?: string;
  drop_number?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

// ============================================
// Service Configuration
// ============================================
export interface WaServiceConfig {
  id: string;
  config_key: string;
  config_value: string;
  config_type: 'string' | 'number' | 'boolean' | 'json';
  category: 'general' | 'service' | 'validation' | 'feature';
  description: string | null;
  is_sensitive: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface WaServiceConfigInput {
  config_value: string;
}

// ============================================
// Service Status
// ============================================
export type ServiceStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'unknown';

export interface WaServiceStatus {
  name: string;
  displayName: string;
  status: ServiceStatus;
  phone_number: string;
  url: string;
  port: number;
  last_message_at: string | null;
  uptime: string | null;
  error_message: string | null;
  session_valid: boolean;
  needs_auth: boolean;
}

export interface WaServicesStatusResponse {
  bridge: WaServiceStatus;
  sender: WaServiceStatus;
  overall: 'healthy' | 'degraded' | 'down';
  checked_at: string;
}

// ============================================
// Pairing / Authentication
// ============================================
export interface WaPairingStatus {
  service: 'bridge' | 'sender';
  status: 'idle' | 'generating' | 'waiting' | 'connected' | 'failed';
  pairing_code: string | null;
  expires_at: string | null;
  error_message: string | null;
}

// ============================================
// Admin Audit Log
// ============================================
export interface WaAdminAuditLog {
  id: string;
  action: string;
  entity_type: 'group' | 'template' | 'config' | 'service';
  entity_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  user_id: string | null;
  user_email: string | null;
  ip_address: string | null;
  created_at: string;
}

// ============================================
// API Responses
// ============================================
export interface WaAdminApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface WaPaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  error?: string;
}

// ============================================
// Test Message
// ============================================
export interface WaTestMessageInput {
  group_id: string;
  message?: string;
}

export interface WaTestMessageResult {
  success: boolean;
  message_id: string | null;
  sent_at: string;
  error_message: string | null;
}

// ============================================
// Phone Numbers (Multi-service Support)
// ============================================
export interface WaPhoneNumber {
  id: string;
  service: 'sender' | 'bridge';
  phone_number: string;
  display_name: string | null;
  role: 'primary' | 'fallback';
  status: 'active' | 'inactive' | 'paired' | 'unpaired';
  last_paired_at: string | null;
  last_disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaPhoneNumberInput {
  service: 'sender' | 'bridge';
  phone_number: string;
  display_name?: string;
  role: 'primary' | 'fallback';
}

export interface WaServicePhoneConfig {
  primary_phone: string;
  fallback_phone: string;
  auto_failover: boolean;
  phones: WaPhoneNumber[];
}

// ============================================
// Send Message
// ============================================
export interface WaSendMessageInput {
  group_id: string;
  message: string;
  mention_phone?: string;
}

// ============================================
// Tab Types for UI
// ============================================
export type WaAdminTab = 'services' | 'chat' | 'send' | 'groups' | 'templates' | 'logs' | 'settings';
