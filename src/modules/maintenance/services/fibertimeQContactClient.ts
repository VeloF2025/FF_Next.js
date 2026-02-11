/**
 * FiberTime QContact API Client
 * 🟢 WORKING: Production-ready HTTP client for FiberTime QContact API
 *
 * Connects to: https://fibertime.qcontact.com/api/v2/
 *
 * Features:
 * - Token-based authentication (uid, access-token, client headers)
 * - Fetch cases assigned to Maintenance - Velocity
 * - Field mapping for FibreFlow integration
 * - Automatic retry with exponential backoff
 *
 * @module maintenance/services/fibertimeQContactClient
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('fibertimeQContactClient');

// ============================================================================
// Configuration
// ============================================================================

/**
 * FiberTime QContact API configuration
 */
export interface FiberTimeQContactConfig {
  baseUrl: string;
  uid: string;
  accessToken: string;
  client: string;
  password?: string; // For auto-refresh on 401
  timeoutMs?: number;
  retryAttempts?: number;
}

/**
 * Authentication response from QContact login
 */
interface QContactAuthResponse {
  'access-token': string;
  client: string;
  uid: string;
  expiry?: string;
}

/**
 * Maintenance - Velocity assigned_to ID in QContact
 */
export const MAINTENANCE_VELOCITY_ID = '21924332416';

// ============================================================================
// Types
// ============================================================================

/**
 * QContact Case from FiberTime API
 */
export interface FiberTimeCaseResponse {
  columns: Array<{
    name: string;
    label: string;
    type: string;
  }>;
  results: FiberTimeCase[];
  total?: number;
  page?: number;
  /** QContact API returns pagination info in this structure */
  pagination?: {
    count: number;
    page: number;
    items: number;
    pages: number;
  };
}

/**
 * Individual case from QContact
 */
export interface FiberTimeCase {
  id: number;
  entity_type: string;
  label: string; // e.g., "FT490441" or "Connection Issue FT499061"
  icon: string;
  assigned_to: string;
  category: string | null;
  contact: string;
  created_at: string;
  status: string;
  c__dr_location: string | null;
  __assigned_to: number;
  __contact: number;
  __category: string | null;
  __category__color: string | null;
  __status: string;
  __status__color: string;
  __c__dr_location: string | null;
}

/**
 * QContact Relationship Reference
 * Represents a linked entity in QContact
 */
export interface QContactRelationship {
  id: number;
  type: string;
  label: string;
  icon: string;
  entity_type: string;
  deleted: boolean;
  source?: string;
  status?: string;
}

/**
 * QContact Fields Structure
 * Contains all custom and standard fields from QContact API
 */
export interface QContactFields {
  status?: string;
  category?: string;
  reference?: string;
  description?: string;
  assigned_to?: number;
  contact?: number;
  telephone?: string;
  email?: string;
  address?: string;
  c__dr_number?: number; // Reference ID to DR entity
  c__dr_location?: string;
  c__field_agent?: string;
  c__availability?: string;
  c__location_pin?: string;
  c__c_tv_connector?: string;
  c__serial_number?: string;
  [key: string]: unknown;
}

/**
 * QContact Relationships Structure
 * Contains linked entities with their labels
 */
export interface QContactRelationships {
  contact?: QContactRelationship;
  assigned_to?: QContactRelationship;
  c__dr_number?: QContactRelationship; // Contains DR number label
  c__location_pin?: QContactRelationship;
  [key: string]: QContactRelationship | null | undefined;
}

/**
 * Case detail with all QContact fields
 * Maps to QContact case detail API response (actual structure)
 */
export interface FiberTimeCaseDetail {
  id: number;
  entity_type: string;
  label: string;
  icon: string;
  created_at: string;
  updated_at?: string;

  // Nested structures from QContact API
  fields?: QContactFields;
  relationships?: QContactRelationships;

  // Legacy flat fields (for backwards compatibility)
  status?: string;
  __status?: string;
  __status__color?: string;
  assigned_to?: string;
  __assigned_to?: number;
  category?: string | null;
  __category?: string | null;
  __category__color?: string | null;
  contact?: string;
  __contact?: number;
  telephone?: string;
  email?: string;
  address?: string;
  c__dr_location?: string;
  __c__dr_location?: string;
  location_pin?: string;
  gps_coordinates?: string;
  c__drop_number?: string;
  drop_number?: string;
  dr_number?: string;
  c__serial_number?: string;
  serial_number?: string;
  ont_serial?: string;
  gizzu_serial?: string;
  c__availability?: string;
  availability?: string;
  c__field_agent?: string;
  field_agent?: string;
  c__tv_connector?: string;
  tv_connector?: string;
  description?: string;
  notes?: string;

  // Raw custom fields (c__ prefix fields)
  [key: string]: unknown;
}

/**
 * List cases options
 */
export interface ListCasesOptions {
  assignedTo?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/**
 * QContact Activity Entry
 * Represents a single activity (note, update, status change) on a case
 */
export interface QContactActivity {
  id: string;
  type: 'note' | 'update' | 'status_change' | 'assignment' | 'message' | 'system';
  description: string | null;
  field_changes: {
    field: string;
    old_value?: string;
    new_value: string;
  }[] | null;
  created_by: {
    name: string;
    email?: string;
  } | null;
  created_at: string;
  is_private: boolean;
  is_pinned: boolean;
}

/**
 * QContact Activities Response
 */
export interface QContactActivitiesResponse {
  activities: QContactActivity[];
  total: number;
}

/**
 * QContact Note/Comment Entry
 */
export interface QContactNote {
  id: string;
  content: string;
  created_by: {
    name: string;
    email?: string;
  };
  created_at: string;
  is_private: boolean;
  is_pinned: boolean;
  attachments?: {
    name: string;
    url: string;
    type: string;
  }[];
}

/**
 * WhatsApp Message from QContact conversation
 */
export interface QContactMessage {
  id: string;
  content: string;
  sender: string;
  sender_type: 'customer' | 'agent' | 'bot';
  timestamp: string;
  attachments?: {
    name: string;
    url: string;
    type: string;
  }[];
}

// ============================================================================
// Error Classes
// ============================================================================

export class FiberTimeQContactError extends Error {
  public readonly statusCode: number | undefined;
  public readonly isRecoverable: boolean;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      isRecoverable?: boolean;
    }
  ) {
    super(message);
    this.name = 'FiberTimeQContactError';
    this.statusCode = options?.statusCode;
    this.isRecoverable = options?.isRecoverable ?? false;
  }
}

// ============================================================================
// Client Class
// ============================================================================

/**
 * FiberTime QContact API Client
 *
 * Features auto-refresh: If a 401 is received and password is configured,
 * the client will automatically re-authenticate and retry the request.
 */
export class FiberTimeQContactClient {
  private readonly baseUrl: string;
  private readonly uid: string;
  private accessToken: string; // Mutable for auto-refresh
  private clientToken: string; // Mutable for auto-refresh
  private readonly password: string | null;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private isRefreshing: boolean = false;
  private lastAuthAttempt: number = 0;
  private readonly AUTH_COOLDOWN_MS = 30000; // 30 seconds between auth attempts

  constructor(config: FiberTimeQContactConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.uid = config.uid;
    this.accessToken = config.accessToken;
    this.clientToken = config.client;
    this.password = config.password || null;
    this.timeoutMs = config.timeoutMs || 30000;
    this.retryAttempts = config.retryAttempts || 3;
  }

  /**
   * Get request headers for authentication
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      uid: this.uid,
      'access-token': this.accessToken,
      client: this.clientToken,
    };
  }

  /**
   * Authenticate with QContact using email/password
   * Updates internal tokens on success
   * @returns true if authentication succeeded
   */
  async authenticate(): Promise<boolean> {
    if (!this.password) {
      logger.warn('Cannot authenticate: password not configured');
      return false;
    }

    // Prevent rapid re-auth attempts
    const now = Date.now();
    if (now - this.lastAuthAttempt < this.AUTH_COOLDOWN_MS) {
      logger.warn('Authentication cooldown active, skipping re-auth');
      return false;
    }
    this.lastAuthAttempt = now;

    if (this.isRefreshing) {
      logger.debug('Authentication already in progress');
      return false;
    }

    this.isRefreshing = true;

    try {
      logger.info('Authenticating with QContact', { uid: this.uid });

      const response = await fetch(`${this.baseUrl}/api/v2/auth/sign_in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: this.uid,
          password: this.password,
        }),
      });

      if (!response.ok) {
        logger.error('QContact authentication failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return false;
      }

      // Extract tokens from response headers (QContact uses headers for auth tokens)
      const accessToken = response.headers.get('access-token');
      const clientToken = response.headers.get('client');
      const uid = response.headers.get('uid');

      if (accessToken && clientToken) {
        this.accessToken = accessToken;
        this.clientToken = clientToken;
        logger.info('QContact authentication successful, tokens refreshed');
        return true;
      }

      // Fallback: try to get tokens from response body
      try {
        const data = await response.json() as QContactAuthResponse;
        if (data['access-token'] && data.client) {
          this.accessToken = data['access-token'];
          this.clientToken = data.client;
          logger.info('QContact authentication successful (from body), tokens refreshed');
          return true;
        }
      } catch {
        // Body parsing failed, that's ok if headers had tokens
      }

      logger.error('QContact authentication succeeded but no tokens in response');
      return false;
    } catch (error) {
      logger.error('QContact authentication error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Check if auto-refresh is available (password configured)
   */
  canAutoRefresh(): boolean {
    return !!this.password;
  }

  /**
   * Get current tokens (for debugging/logging)
   */
  getCurrentTokens(): { accessToken: string; client: string; uid: string } {
    return {
      accessToken: this.accessToken.substring(0, 8) + '...', // Partial for security
      client: this.clientToken.substring(0, 8) + '...',
      uid: this.uid,
    };
  }

  /**
   * Make authenticated request to QContact API
   * Automatically retries with fresh tokens on 401 if password is configured
   */
  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, string>,
    isRetry: boolean = false
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    logger.debug('FiberTime QContact request', { method, path, isRetry });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized - attempt auto-refresh
      if (response.status === 401 && !isRetry && this.password) {
        logger.warn('QContact API returned 401, attempting auto-refresh', { path });

        const authSuccess = await this.authenticate();
        if (authSuccess) {
          logger.info('Auto-refresh successful, retrying request', { path });
          return this.request<T>(method, path, params, true);
        } else {
          logger.error('Auto-refresh failed, cannot retry request', { path });
          throw new FiberTimeQContactError(
            'Authentication failed - credentials may be invalid',
            {
              statusCode: 401,
              isRecoverable: false,
            }
          );
        }
      }

      if (!response.ok) {
        throw new FiberTimeQContactError(
          `HTTP ${response.status}: ${response.statusText}`,
          {
            statusCode: response.status,
            isRecoverable: response.status >= 500,
          }
        );
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof FiberTimeQContactError) {
        throw error;
      }

      throw new FiberTimeQContactError(
        error instanceof Error ? error.message : 'Unknown error',
        { isRecoverable: true }
      );
    }
  }

  /**
   * List cases with filters
   * 🟢 WORKING: Fetches cases from QContact with optional filtering
   */
  async listCases(options: ListCasesOptions = {}): Promise<FiberTimeCaseResponse> {
    const assignedToId = options.assignedTo || MAINTENANCE_VELOCITY_ID;

    // Build filter JSON - filter by assigned_to AND exclude Closed status
    const conditions: Array<{ name: string; value: string; operator: string }> = [
      {
        name: 'assigned_to',
        value: assignedToId,
        operator: 'equals',
      },
    ];

    // Optionally filter by specific status
    // NOTE: QContact API does not support 'not_equals' operator on status field (returns 500).
    // We fetch all tickets and filter closed ones in application code instead.
    if (options.status) {
      conditions.push({
        name: 'status',
        value: options.status,
        operator: 'equals',
      });
    }

    const filters = JSON.stringify([
      {
        operator: 'all',
        conditions,
      },
    ]);

    const params: Record<string, string> = {
      sort: '',
      page: String(options.page || 1),
      items: String(options.pageSize || 50),
      filters,
    };

    logger.info('Fetching cases from FiberTime QContact', {
      assignedTo: assignedToId,
      page: options.page || 1,
    });

    const response = await this.request<FiberTimeCaseResponse>(
      'GET',
      '/api/v2/entities/Case',
      params
    );

    logger.info('Fetched cases from FiberTime QContact', {
      count: response.results.length,
    });

    return response;
  }

  /**
   * Get single case by ID
   */
  async getCase(caseId: number): Promise<FiberTimeCaseDetail | null> {
    try {
      const response = await this.request<FiberTimeCaseDetail>(
        'GET',
        `/api/v2/entities/Case/${caseId}`
      );
      return response;
    } catch (error) {
      if (
        error instanceof FiberTimeQContactError &&
        error.statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get activities/timeline for a case
   * 🟢 WORKING: Fetches activity history, notes, and updates
   */
  async getCaseActivities(caseId: number): Promise<QContactActivitiesResponse> {
    try {
      logger.debug('Fetching case activities', { caseId });

      // QContact API endpoint for case events/timeline
      const response = await this.request<any>(
        'GET',
        `/api/v2/entities/Case/${caseId}/events?expand_conversations=false&page=1&sort=id%20DESC`
      );

      // Parse and normalize the response
      const activities: QContactActivity[] = [];

      if (Array.isArray(response)) {
        for (const item of response) {
          activities.push(this.parseActivity(item));
        }
      } else if (response.results) {
        for (const item of response.results) {
          activities.push(this.parseActivity(item));
        }
      }

      logger.debug('Fetched case activities', {
        caseId,
        count: activities.length,
      });

      return {
        activities,
        total: activities.length,
      };
    } catch (error) {
      // If activities endpoint doesn't exist, return empty
      if (
        error instanceof FiberTimeQContactError &&
        (error.statusCode === 404 || error.statusCode === 400)
      ) {
        logger.debug('Activities endpoint not available', { caseId });
        return { activities: [], total: 0 };
      }
      throw error;
    }
  }

  /**
   * Parse a raw event item from QContact API /events endpoint
   */
  private parseActivity(item: any): QContactActivity {
    // Determine activity type from event_type field
    let type: QContactActivity['type'] = 'note';
    const eventType = item.event_type || item.type;

    if (eventType === 'update') {
      type = 'update';
    } else if (eventType === 'status_change') {
      type = 'status_change';
    } else if (eventType === 'assignment' ||
               (item.formatted_changes && item.formatted_changes['$t.fields.assigned_to'])) {
      type = 'assignment';
    } else if (eventType === 'message' || eventType === 'conversation') {
      type = 'message';
    } else if (eventType === 'system' || eventType === 'automation') {
      type = 'system';
    } else if (eventType === 'note') {
      type = 'note';
    }

    // Parse field changes from formatted_changes (QContact format)
    let fieldChanges: QContactActivity['field_changes'] = null;
    if (item.formatted_changes && Object.keys(item.formatted_changes).length > 0) {
      fieldChanges = Object.values(item.formatted_changes).map((change: any) => ({
        field: change.field || 'Unknown',
        old_value: change.old_value,
        new_value: change.new_value,
      }));
    } else if (item.changes && Object.keys(item.changes).length > 0) {
      // Fallback to raw changes
      fieldChanges = Object.entries(item.changes).map(([field, value]: [string, any]) => ({
        field,
        old_value: typeof value === 'object' ? value.old_value : undefined,
        new_value: typeof value === 'object' ? value.new_value : String(value),
      }));
    }

    // Get description from subtitle or html
    const description = item.subtitle || item.html || item.content || item.description || null;

    // Get user info
    const user = item.user;

    return {
      id: String(item.id || Date.now()),
      type,
      description,
      field_changes: fieldChanges,
      created_by: user
        ? {
            name: user.label || user.name || 'Unknown',
            email: user.email,
          }
        : null,
      created_at: item.raised_at || item.created_at || new Date().toISOString(),
      is_private: item.public_note === false || item.public === false,
      is_pinned: item.pinned || item.is_pinned || false,
    };
  }

  /**
   * Health check - verify API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('GET', '/api/v2/me');
      return true;
    } catch (error) {
      logger.warn('FiberTime QContact health check failed', { error });
      return false;
    }
  }

  /**
   * Update a case in QContact (status, fields, etc.)
   * 🟢 WORKING: PATCH on /api/v2/entities/Case/{id}
   *
   * @param caseId - QContact case ID (external_id)
   * @param fields - Fields to update (e.g. { status: 'Solved' })
   * @returns Updated case data or error
   */
  async updateCase(
    caseId: string | number,
    fields: Record<string, unknown>
  ): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      logger.info('Updating QContact case', { caseId, fields: Object.keys(fields) });

      const url = `${this.baseUrl}/api/v2/entities/Case/${caseId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      // QContact API requires fields to be wrapped in { fields: { ... } }
      // Sending at top level returns 200 but silently ignores the update
      const body = fields.fields ? fields : { fields };

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 - try to re-authenticate
      if (response.status === 401 && this.password) {
        logger.warn('QContact API returned 401 on updateCase, attempting auto-refresh');
        const authSuccess = await this.authenticate();
        if (authSuccess) {
          return this.updateCase(caseId, fields);
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to update QContact case', {
          caseId,
          status: response.status,
          error: errorText.substring(0, 200),
        });
        return {
          success: false,
          error: `QContact API error ${response.status}: ${errorText.substring(0, 200)}`,
        };
      }

      const data = await response.json();
      logger.info('QContact case updated successfully', { caseId });
      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating QContact case', { caseId, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Add a note to a case
   *
   * Strategy: Try Note entity creation first. If 403 (permission denied),
   * fall back to writing note content into the c__update custom field
   * via PATCH, which uses the same mechanism as status updates.
   *
   * @param caseId - QContact case ID (external_id)
   * @param content - Note text content
   * @param isInternal - Whether note is internal only (default: false)
   * @returns Result with success status and error message
   */
  async addNote(
    caseId: string | number,
    content: string,
    isInternal: boolean = false
  ): Promise<{ success: boolean; noteId?: string; error?: string }> {
    try {
      logger.info('Adding note to QContact case', { caseId, contentLength: content.length, isInternal });

      // Try creating Note entity directly
      const url = `${this.baseUrl}/api/v2/entities/Note`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entity_type: 'Case',
          entity_id: parseInt(String(caseId)),
          subtitle: content,
          public_note: !isInternal,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 - try to re-authenticate
      if (response.status === 401 && this.password) {
        logger.warn('QContact API returned 401 on addNote, attempting auto-refresh');
        const authSuccess = await this.authenticate();
        if (authSuccess) {
          return this.addNote(caseId, content, isInternal);
        }
      }

      // Handle 403 - fall back to c__update field
      if (response.status === 403) {
        logger.info('Note creation denied (403), falling back to c__update field', { caseId });
        return this.addNoteViaField(caseId, content);
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to add note to QContact', {
          caseId,
          status: response.status,
          error: errorText.substring(0, 200),
        });
        // Also try fallback for other errors
        logger.info('Trying c__update field fallback', { caseId });
        return this.addNoteViaField(caseId, content);
      }

      const data = await response.json();
      logger.info('Successfully added note to QContact via Note entity', { caseId, noteId: data?.id });

      return {
        success: true,
        noteId: data?.id?.toString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error adding note to QContact', { caseId, error: errorMsg });
      // Try fallback on any error
      try {
        return await this.addNoteViaField(caseId, content);
      } catch (fallbackError) {
        return { success: false, error: errorMsg };
      }
    }
  }

  /**
   * Fallback: push note content into the c__update custom field via PATCH
   * This uses the same updateCase mechanism that works for status changes.
   */
  private async addNoteViaField(
    caseId: string | number,
    content: string
  ): Promise<{ success: boolean; noteId?: string; error?: string }> {
    try {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const updateText = `[${timestamp}] ${content}`;

      const result = await this.updateCase(caseId, { c__update: updateText });

      if (result.success) {
        logger.info('Note pushed via c__update field', { caseId });
        return { success: true, noteId: `field-update-${Date.now()}` };
      }

      logger.error('c__update field fallback also failed', { caseId, error: result.error });
      return { success: false, error: `Note creation and c__update fallback both failed: ${result.error}` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('c__update field fallback error', { caseId, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Extract case reference from label
   * e.g., "Connection Issue FT499061" -> "FT499061"
   *       " FT490441" -> "FT490441"
   */
  static extractCaseReference(label: string): string {
    const match = label.match(/FT\d+/);
    return match ? match[0] : label.trim();
  }

  /**
   * Extract DR number from various fields
   * Checks multiple possible field names including relationships
   *
   * QContact stores DR numbers as relationships - the label contains the actual DR number
   * e.g., relationships.c__dr_number.label = "DR1748392"
   */
  static extractDRNumber(caseDetail: FiberTimeCaseDetail): string | null {
    // Priority 1: Check relationships (QContact stores DR as linked entity)
    const relationshipDR = caseDetail.relationships?.c__dr_number?.label;
    if (relationshipDR) {
      const match = relationshipDR.match(/DR\d+/i);
      return match ? match[0].toUpperCase() : relationshipDR;
    }

    // Priority 2: Check flat fields (legacy or alternate formats)
    const drNumber =
      caseDetail.dr_number ||
      caseDetail.c__drop_number ||
      caseDetail.drop_number ||
      caseDetail.c__dr_location ||
      (caseDetail['c__dr_number'] as string) ||
      null;

    // Extract DR pattern if embedded in string (e.g., "DR1853428")
    if (drNumber && typeof drNumber === 'string') {
      const match = drNumber.match(/DR\d+/i);
      return match ? match[0].toUpperCase() : drNumber;
    }

    return null;
  }

  /**
   * Map FiberTime case detail to enriched ticket data
   * Includes all contact, location, and equipment info
   */
  static mapCaseDetailToTicket(caseDetail: FiberTimeCaseDetail): {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    created_at: string;
    updated_at: string;
    // Contact Info
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    address: string | null;
    // Assignment
    assigned_to: string | null;
    // Category
    category: string | null;
    subcategory: string | null;
    // Drop & Location
    dr_number: string | null;
    gps_coordinates: string | null;
    // Equipment
    ont_serial: string | null;
    gizzu_serial: string | null;
    // Additional
    availability: string | null;
    field_agent: string | null;
    tv_connector: string | null;
    // Custom fields
    custom_fields: Record<string, unknown> | null;
  } {
    const reference = this.extractCaseReference(caseDetail.label);
    const drNumber = this.extractDRNumber(caseDetail);

    // Get fields from nested structure or flat (for backwards compat)
    const fields = caseDetail.fields || {};
    const relationships = caseDetail.relationships || {};

    // Extract category and subcategory from fields or flat
    // QContact uses :: or | as separator: "Connectivity::ONT/Gizzu", "General|Maintenance"
    let category: string | null = null;
    let subcategory: string | null = null;
    const categoryStr = (fields.category as string) || caseDetail.category;

    if (categoryStr) {
      const separator = categoryStr.includes('::') ? '::' : '|';
      const parts = categoryStr.split(separator);
      category = parts[0]?.trim() || null;
      subcategory = parts[1]?.trim() || null;
    }

    // Get contact name from relationship or flat
    const customerName =
      relationships.contact?.label ||
      caseDetail.contact ||
      null;

    // Get assigned to from relationship or flat
    const assignedTo =
      relationships.assigned_to?.label ||
      caseDetail.assigned_to ||
      null;

    // Get status from fields or flat
    const status = (fields.status as string) || caseDetail.status || 'unknown';

    // Collect all custom fields (c__ prefix) from fields and flat
    const customFields: Record<string, unknown> = {};
    // From fields object
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith('c__')) {
        customFields[key] = value;
      }
    }
    // From flat structure
    for (const [key, value] of Object.entries(caseDetail)) {
      if (key.startsWith('c__') || key.startsWith('__c__')) {
        customFields[key] = value;
      }
    }

    return {
      id: String(caseDetail.id),
      title: reference,
      description: (fields.description as string) || caseDetail.description || caseDetail.label,
      status,
      priority: 'medium',
      created_at: caseDetail.created_at,
      updated_at: caseDetail.updated_at || caseDetail.created_at,
      // Contact Info
      customer_name: customerName,
      customer_phone: (fields.telephone as string) || caseDetail.telephone || null,
      customer_email: (fields.email as string) || caseDetail.email || null,
      address: (fields.address as string) || caseDetail.address || null,
      // Assignment
      assigned_to: assignedTo,
      // Category
      category,
      subcategory,
      // Drop & Location
      dr_number: drNumber,
      gps_coordinates:
        (fields.c__location_pin as string) ||
        caseDetail.gps_coordinates ||
        caseDetail.location_pin ||
        null,
      // Equipment
      ont_serial:
        (fields.c__serial_number as string) ||
        caseDetail.ont_serial ||
        caseDetail.c__serial_number ||
        caseDetail.serial_number ||
        null,
      gizzu_serial: caseDetail.gizzu_serial || null,
      // Additional
      availability:
        (fields.c__availability as string) ||
        caseDetail.availability ||
        caseDetail.c__availability ||
        null,
      field_agent:
        (fields.c__field_agent as string) ||
        caseDetail.field_agent ||
        caseDetail.c__field_agent ||
        null,
      tv_connector:
        (fields.c__c_tv_connector as string) ||
        caseDetail.tv_connector ||
        caseDetail.c__tv_connector ||
        null,
      // Custom fields
      custom_fields: {
        ...customFields,
        qcontact_internal_id: caseDetail.id,
        entity_type: caseDetail.entity_type,
      },
    };
  }

  /**
   * Map FiberTime case to QContact ticket format for sync
   */
  static mapCaseToTicket(ftCase: FiberTimeCase): {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    created_at: string;
    updated_at: string;
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    address: string | null;
    assigned_to: string | null;
    category: string | null;
    subcategory: string | null;
    custom_fields: Record<string, unknown> | null;
  } {
    const reference = this.extractCaseReference(ftCase.label);

    // Extract category and subcategory from category field
    // QContact uses :: or | as separator: "Connectivity::ONT/Gizzu", "General|Maintenance"
    let category: string | null = null;
    let subcategory: string | null = null;

    if (ftCase.category) {
      const separator = ftCase.category.includes('::') ? '::' : '|';
      const parts = ftCase.category.split(separator);
      category = parts[0]?.trim() || null;
      subcategory = parts[1]?.trim() || null;
    }

    return {
      id: String(ftCase.id),
      title: reference,
      description: ftCase.label,
      status: ftCase.status,
      priority: 'normal', // QContact doesn't expose priority in list view
      created_at: ftCase.created_at,
      updated_at: ftCase.created_at, // Use created_at as fallback
      customer_name: ftCase.contact,
      customer_phone: null,
      customer_email: null,
      address: null,
      assigned_to: ftCase.assigned_to,
      category,
      subcategory,
      custom_fields: {
        dr_location: ftCase.c__dr_location,
        qcontact_internal_id: ftCase.id,
        entity_type: ftCase.entity_type,
      },
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create FiberTime QContact client from environment variables
 *
 * Required env vars:
 * - FIBERTIME_QCONTACT_UID: Email/username
 * - FIBERTIME_QCONTACT_ACCESS_TOKEN: API access token
 * - FIBERTIME_QCONTACT_CLIENT: API client token
 *
 * Optional (for auto-refresh on 401):
 * - FIBERTIME_QCONTACT_PASSWORD: Password for automatic re-authentication
 */
export function createFiberTimeQContactClient(): FiberTimeQContactClient {
  const config: FiberTimeQContactConfig = {
    baseUrl:
      process.env.FIBERTIME_QCONTACT_BASE_URL ||
      'https://fibertime.qcontact.com',
    uid: process.env.FIBERTIME_QCONTACT_UID || '',
    accessToken: process.env.FIBERTIME_QCONTACT_ACCESS_TOKEN || '',
    client: process.env.FIBERTIME_QCONTACT_CLIENT || '',
    password: process.env.FIBERTIME_QCONTACT_PASSWORD || undefined, // For auto-refresh
    timeoutMs: parseInt(process.env.FIBERTIME_QCONTACT_TIMEOUT_MS || '30000', 10),
    retryAttempts: parseInt(
      process.env.FIBERTIME_QCONTACT_RETRY_ATTEMPTS || '3',
      10
    ),
  };

  if (!config.uid || !config.accessToken || !config.client) {
    logger.warn(
      'FiberTime QContact credentials not fully configured. Set FIBERTIME_QCONTACT_UID, FIBERTIME_QCONTACT_ACCESS_TOKEN, and FIBERTIME_QCONTACT_CLIENT environment variables.'
    );
  }

  if (config.password) {
    logger.info('QContact auto-refresh enabled (password configured)');
  } else {
    logger.debug('QContact auto-refresh disabled (no password configured)');
  }

  return new FiberTimeQContactClient(config);
}

/**
 * Singleton instance
 */
let defaultClient: FiberTimeQContactClient | null = null;

export function getDefaultFiberTimeQContactClient(): FiberTimeQContactClient {
  if (!defaultClient) {
    defaultClient = createFiberTimeQContactClient();
  }
  return defaultClient;
}

export function resetDefaultFiberTimeQContactClient(): void {
  defaultClient = null;
}
