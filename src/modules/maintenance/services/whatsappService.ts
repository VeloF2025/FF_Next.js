/**
 * WhatsApp Service - WAHA API Integration
 * 🟢 WORKING: Production-ready WhatsApp notification service via WAHA
 *
 * Features:
 * - Send WhatsApp messages via WAHA HTTP API
 * - Template-based messaging with variable substitution
 * - Delivery status tracking (sent, delivered, read, failed)
 * - Automatic retry with exponential backoff
 * - Batch notifications support
 * - Webhook handling for delivery updates
 * - Database persistence for all notifications
 * - Session health monitoring
 *
 * @module ticketing/services/whatsappService
 */

import { createLogger } from '@/lib/logger';
import { query, queryOne } from '../utils/db';
import type {
  WhatsAppNotification,
  SendNotificationRequest,
  NotificationDeliveryStatus,
  WAHAWebhookPayload,
  BatchNotificationRequest,
  BatchNotificationResult,
  NotificationFilters,
  NotificationListResponse,
  NotificationVariables,
} from '../types/whatsapp';
import { RecipientType, NotificationStatus, NotificationUseCase } from '../types/whatsapp';

// 🟢 WORKING: Logger instance for WhatsApp service
const logger = createLogger('whatsappService');

// ============================================================================
// Configuration
// ============================================================================

/**
 * WAHA API Configuration
 * 🟢 WORKING: Configuration for WAHA WhatsApp HTTP API
 */
export interface WAHAConfig {
  base_url: string; // WAHA API base URL
  api_key: string; // WAHA API key
  session_name: string; // WhatsApp session name
  timeout_ms: number; // Request timeout in milliseconds
  retry_attempts: number; // Number of retry attempts
}

// ============================================================================
// Error Codes
// ============================================================================

/**
 * WAHA API error codes
 * 🟢 WORKING: Comprehensive error code enumeration
 */
export enum WAHAErrorCode {
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  SESSION_NOT_READY = 'SESSION_NOT_READY',
  INVALID_PHONE = 'INVALID_PHONE',
  MESSAGE_FAILED = 'MESSAGE_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SERVER_ERROR = 'SERVER_ERROR',
  TEMPLATE_ERROR = 'TEMPLATE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
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
 * WAHA API Error
 * 🟢 WORKING: Custom error class with rich metadata for debugging
 */
export class WAHAError extends Error {
  public readonly code: WAHAErrorCode;
  public readonly statusCode: number | undefined;
  public readonly requestUrl: string | undefined;
  public readonly phone: string | undefined;
  public readonly isRecoverable: boolean;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: WAHAErrorCode,
    options?: {
      statusCode?: number;
      requestUrl?: string;
      phone?: string;
      isRecoverable?: boolean;
      details?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'WAHAError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.requestUrl = options?.requestUrl;
    this.phone = options?.phone;
    this.isRecoverable = options?.isRecoverable ?? false;
    this.details = options?.details;

    Error.captureStackTrace?.(this, WAHAError);
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * WAHA send message payload
 * 🟢 WORKING: Matches WAHA API sendText endpoint requirements
 */
export interface WAHASendMessagePayload {
  chatId: string; // Phone number in format: 1234567890@c.us
  text: string; // Message text
  session?: string; // Session name (optional, can be in query param)
}

/**
 * WAHA send message response
 * 🟢 WORKING: Response from WAHA sendText endpoint
 */
export interface WAHASendMessageResponse {
  id: string; // WAHA message ID
  timestamp: number; // Unix timestamp
  status?: string; // Message status
}

// ============================================================================
// Message Templates
// ============================================================================

/**
 * Message templates with variable placeholders
 * 🟢 WORKING: Pre-defined templates for common notification scenarios
 */
const MESSAGE_TEMPLATES: Record<
  string,
  {
    template: string;
    required_variables: string[];
  }
> = {
  ticket_assigned: {
    template:
      'Hi {{assignee_name}},\n\nTicket {{ticket_uid}} has been assigned to you.\n\nDR Number: {{dr_number}}\n\nPlease review and take action.',
    required_variables: ['assignee_name', 'ticket_uid', 'dr_number'],
  },
  qa_rejected: {
    template:
      'Ticket {{ticket_uid}} has been rejected by QA.\n\nReason: {{rejection_reason}}\n\nPlease review and resubmit.',
    required_variables: ['ticket_uid', 'rejection_reason'],
  },
  qa_approved: {
    template:
      'Great work! Ticket {{ticket_uid}} has been approved by QA.',
    required_variables: ['ticket_uid'],
  },
  ticket_closed: {
    template:
      'Ticket {{ticket_uid}} has been closed.\n\nThank you for your service.',
    required_variables: ['ticket_uid'],
  },
  sla_warning: {
    template:
      '⚠️ SLA Warning: Ticket {{ticket_uid}} is due at {{sla_due_time}}.\n\nPlease prioritize.',
    required_variables: ['ticket_uid', 'sla_due_time'],
  },
  risk_expiring: {
    template:
      'Risk acceptance for ticket {{ticket_uid}} is expiring on {{expiry_date}}.\n\nRisk: {{risk_description}}',
    required_variables: ['ticket_uid', 'expiry_date', 'risk_description'],
  },
};

// ============================================================================
// Service Class
// ============================================================================

/**
 * WhatsApp Notification Service
 * 🟢 WORKING: Full-featured WhatsApp notification service via WAHA
 *
 * @example
 * const service = createWhatsAppService({
 *   base_url: 'https://waha.example.com',
 *   api_key: 'your-api-key',
 *   session_name: 'default',
 *   timeout_ms: 10000,
 *   retry_attempts: 3,
 * });
 *
 * const notification = await service.sendNotification({
 *   ticket_id: 'ticket-uuid',
 *   recipient_type: RecipientType.CONTRACTOR,
 *   recipient_phone: '+27821234567',
 *   message_content: 'Your ticket has been assigned.',
 * });
 */
export class WhatsAppService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sessionName: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;

  constructor(config: WAHAConfig) {
    // 🟢 WORKING: Validate required configuration
    if (!config.base_url || config.base_url.trim() === '') {
      throw new Error('WAHA API base_url is required');
    }
    if (!config.api_key || config.api_key.trim() === '') {
      throw new Error('WAHA API api_key is required');
    }
    if (!config.session_name || config.session_name.trim() === '') {
      throw new Error('WAHA session_name is required');
    }

    this.baseUrl = config.base_url.replace(/\/$/, '');
    this.apiKey = config.api_key;
    this.sessionName = config.session_name;
    this.timeoutMs = config.timeout_ms || 30000;
    this.retryAttempts = config.retry_attempts || 3;
  }

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  /**
   * Send a WhatsApp notification
   * 🟢 WORKING: Sends message via WAHA and stores in database
   */
  async sendNotification(
    request: SendNotificationRequest
  ): Promise<WhatsAppNotification> {
    const startTime = Date.now();

    try {
      // Process template if template_id is provided
      let messageContent: string;
      if (request.template_id) {
        messageContent = this.processTemplate(
          request.template_id,
          request.variables || {}
        );
      } else if (request.message_content) {
        messageContent = request.message_content;
      } else {
        throw new WAHAError(
          'Either template_id or message_content is required',
          WAHAErrorCode.VALIDATION_ERROR
        );
      }

      // Send via WAHA API
      const wahaResponse = await this.sendViaWAHA(
        request.recipient_phone,
        messageContent
      );

      // Store notification in database
      const notification = await this.storeNotification({
        ticket_id: request.ticket_id || null,
        recipient_type: request.recipient_type,
        recipient_phone: request.recipient_phone,
        recipient_name: request.recipient_name || null,
        message_template: request.template_id || null,
        message_content: messageContent,
        status: NotificationStatus.SENT,
        waha_message_id: wahaResponse.id,
        sent_at: new Date(),
      });

      const duration = Date.now() - startTime;
      logger.info('WhatsApp notification sent successfully', {
        notification_id: notification.id,
        ticket_id: request.ticket_id,
        recipient_phone: request.recipient_phone,
        duration_ms: duration,
      });

      return notification;
    } catch (error) {
      logger.error('Failed to send WhatsApp notification', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ticket_id: request.ticket_id,
        recipient_phone: request.recipient_phone,
      });

      // Store failed notification (skip only template/pre-send validation errors)
      if (
        error instanceof WAHAError &&
        error.code !== WAHAErrorCode.TEMPLATE_ERROR
      ) {
        try {
          await this.storeNotification({
            ticket_id: request.ticket_id || null,
            recipient_type: request.recipient_type,
            recipient_phone: request.recipient_phone,
            recipient_name: request.recipient_name || null,
            message_template: request.template_id || null,
            message_content: request.message_content || '',
            status: NotificationStatus.FAILED,
            waha_message_id: null,
            error_message: error.message,
          });
        } catch (storeError) {
          // Log but don't let storage failure override the original error
          logger.warn('Failed to store notification in database', {
            storeError: storeError instanceof Error ? storeError.message : 'Unknown',
            originalError: error.message,
          });
        }
      }

      throw error;
    }
  }

  /**
   * Handle webhook from WAHA for delivery status updates
   * 🟢 WORKING: Updates notification status based on webhook events
   */
  async handleWebhook(payload: WAHAWebhookPayload): Promise<void> {
    logger.debug('Processing WAHA webhook', {
      event: payload.event,
      message_id: payload.message_id,
    });

    let status: NotificationStatus;
    let updateField: string;
    let updateValue: Date | null = new Date(payload.timestamp);

    switch (payload.event) {
      case 'message.sent':
        status = NotificationStatus.SENT;
        updateField = 'sent_at';
        break;
      case 'message.delivered':
        status = NotificationStatus.DELIVERED;
        updateField = 'delivered_at';
        break;
      case 'message.read':
        status = NotificationStatus.READ;
        updateField = 'read_at';
        break;
      case 'message.failed':
        status = NotificationStatus.FAILED;
        updateField = 'error_message';
        updateValue = null;
        break;
      default:
        logger.warn('Unknown webhook event', { event: payload.event });
        return;
    }

    // Update notification in database
    if (status === NotificationStatus.FAILED) {
      await query(
        `UPDATE whatsapp_notifications
         SET status = $1, error_message = $2
         WHERE waha_message_id = $3`,
        [status, payload.error || 'Message delivery failed', payload.message_id]
      );
    } else {
      await query(
        `UPDATE whatsapp_notifications
         SET status = $1, ${updateField} = $2
         WHERE waha_message_id = $3`,
        [status, updateValue, payload.message_id]
      );
    }

    logger.info('Notification status updated via webhook', {
      message_id: payload.message_id,
      status,
    });
  }

  /**
   * Get notification delivery status by ID
   * 🟢 WORKING: Fetches notification with delivery metrics
   */
  async getNotificationStatus(
    notificationId: string
  ): Promise<NotificationDeliveryStatus | null> {
    const notification = await queryOne<WhatsAppNotification>(
      'SELECT * FROM whatsapp_notifications WHERE id = $1',
      [notificationId]
    );

    if (!notification) {
      return null;
    }

    // Calculate retry capability
    const canRetry =
      notification.status === NotificationStatus.FAILED &&
      notification.error_message !== null;

    return {
      notification_id: notification.id,
      ticket_id: notification.ticket_id,
      status: notification.status,
      sent_at: notification.sent_at,
      delivered_at: notification.delivered_at,
      read_at: notification.read_at,
      error_message: notification.error_message,
      retry_count: 0, // TODO: Implement retry counting
      can_retry: canRetry,
    };
  }

  /**
   * Retry a failed notification
   * 🟢 WORKING: Attempts to resend a failed notification
   */
  async retryNotification(notificationId: string): Promise<boolean> {
    const notification = await queryOne<WhatsAppNotification>(
      'SELECT * FROM whatsapp_notifications WHERE id = $1',
      [notificationId]
    );

    if (!notification) {
      logger.warn('Notification not found for retry', { notificationId });
      return false;
    }

    if (notification.status !== NotificationStatus.FAILED) {
      logger.warn('Cannot retry non-failed notification', {
        notificationId,
        status: notification.status,
      });
      return false;
    }

    try {
      // Resend via WAHA
      const wahaResponse = await this.sendViaWAHA(
        notification.recipient_phone!,
        notification.message_content
      );

      // Update notification
      await query(
        `UPDATE whatsapp_notifications
         SET status = $1, waha_message_id = $2, sent_at = NOW(), error_message = NULL
         WHERE id = $3`,
        [NotificationStatus.SENT, wahaResponse.id, notificationId]
      );

      logger.info('Notification retried successfully', { notificationId });
      return true;
    } catch (error) {
      logger.error('Failed to retry notification', {
        notificationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Send batch notifications
   * 🟡 PARTIAL: Basic framework works, but requires phone number lookup from tickets/contractors
   *
   * TODO: Implement phone number fetching from:
   * - tickets.assigned_to -> users.phone or
   * - tickets.assigned_contractor_id -> contractors.phone
   */
  async sendBatchNotifications(
    request: BatchNotificationRequest
  ): Promise<BatchNotificationResult> {
    const results: BatchNotificationResult = {
      total: request.ticket_ids?.length || 0,
      sent: 0,
      failed: 0,
      notification_ids: [],
      errors: [],
    };

    if (!request.ticket_ids || request.ticket_ids.length === 0) {
      return results;
    }

    // 🟡 PARTIAL: Phone number lookup not yet implemented
    // For now, batch notifications require phone numbers in variables_per_ticket
    // or integration with ticket/contractor lookup service

    // Send notifications sequentially to avoid rate limiting
    for (const ticketId of request.ticket_ids) {
      try {
        const variables =
          request.variables_per_ticket?.[ticketId] || {};

        // Extract phone from variables if provided, otherwise skip
        const recipientPhone = variables.recipient_phone as string;
        if (!recipientPhone) {
          results.failed++;
          results.errors.push({
            ticket_id: ticketId,
            error: 'Recipient phone number not provided (phone lookup from tickets not yet implemented)',
          });
          continue;
        }

        const notification = await this.sendNotification({
          ticket_id: ticketId,
          recipient_type: request.recipient_type,
          recipient_phone: recipientPhone,
          template_id: request.template_id,
          variables,
        });

        results.sent++;
        results.notification_ids.push(notification.id);
      } catch (error) {
        results.failed++;
        results.errors.push({
          ticket_id: ticketId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Batch notifications completed', {
      total: results.total,
      sent: results.sent,
      failed: results.failed,
    });

    return results;
  }

  /**
   * Check if WAHA API is healthy
   * 🟢 WORKING: Returns true if API responds, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/server/status`;
      const response = await this.makeRequest(url, {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
      logger.warn('WAHA health check failed', { error });
      return false;
    }
  }

  /**
   * Check if WhatsApp session is ready
   * 🟢 WORKING: Verifies session is in WORKING state
   */
  async isSessionReady(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/sessions/${this.sessionName}`;
      const response = await this.makeRequest(url, {
        method: 'GET',
      });

      const data = await response.json();
      return data.status === 'WORKING';
    } catch (error) {
      logger.warn('Failed to check session status', { error });
      return false;
    }
  }

  /**
   * List notifications with filters
   * 🟢 WORKING: Retrieves notifications with statistics
   */
  async listNotifications(
    filters: NotificationFilters
  ): Promise<NotificationListResponse> {
    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.ticket_id) {
      conditions.push(`ticket_id = $${params.length + 1}`);
      params.push(filters.ticket_id);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`status = ANY($${params.length + 1})`);
        params.push(filters.status);
      } else {
        conditions.push(`status = $${params.length + 1}`);
        params.push(filters.status);
      }
    }

    if (filters.recipient_type) {
      if (Array.isArray(filters.recipient_type)) {
        conditions.push(`recipient_type = ANY($${params.length + 1})`);
        params.push(filters.recipient_type);
      } else {
        conditions.push(`recipient_type = $${params.length + 1}`);
        params.push(filters.recipient_type);
      }
    }

    if (filters.sent_after) {
      conditions.push(`sent_at >= $${params.length + 1}`);
      params.push(filters.sent_after);
    }

    if (filters.sent_before) {
      conditions.push(`sent_at <= $${params.length + 1}`);
      params.push(filters.sent_before);
    }

    if (filters.failed_only) {
      conditions.push(`status = '${NotificationStatus.FAILED}'`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const queryText = `SELECT * FROM whatsapp_notifications ${whereClause} ORDER BY created_at DESC`;
    const notifications = await query<WhatsAppNotification>(queryText, params);

    // Calculate statistics
    const total = notifications.length;
    const byStatus: Record<NotificationStatus, number> = {
      [NotificationStatus.PENDING]: 0,
      [NotificationStatus.SENT]: 0,
      [NotificationStatus.DELIVERED]: 0,
      [NotificationStatus.READ]: 0,
      [NotificationStatus.FAILED]: 0,
    };

    for (const notification of notifications) {
      byStatus[notification.status] =
        (byStatus[notification.status] || 0) + 1;
    }

    const successfulDeliveries =
      byStatus[NotificationStatus.DELIVERED] +
      byStatus[NotificationStatus.READ];
    const deliveryRate =
      total > 0 ? (successfulDeliveries / total) * 100 : 0;

    return {
      notifications,
      total,
      by_status: byStatus,
      delivery_rate: deliveryRate,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Send message via WAHA API
   * 🟢 WORKING: Handles WAHA HTTP request with retry logic
   */
  private async sendViaWAHA(
    phone: string,
    text: string
  ): Promise<WAHASendMessageResponse> {
    const chatId = this.formatPhoneForWAHA(phone);
    const url = `${this.baseUrl}/api/sendText?session=${this.sessionName}`;

    const payload: WAHASendMessagePayload = {
      chatId,
      text,
    };

    return this.executeWithRetry<WAHASendMessageResponse>(
      url,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      { phone, retryAttempts: this.retryAttempts }
    );
  }

  /**
   * Execute request with retry logic
   * 🟢 WORKING: Implements exponential backoff with jitter
   */
  private async executeWithRetry<T>(
    url: string,
    options: RequestInit,
    context: { phone: string; retryAttempts: number }
  ): Promise<T> {
    const { phone, retryAttempts } = context;
    let lastError: WAHAError | undefined;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        const response = await this.makeRequest(url, options);
        return await this.handleResponse<T>(response, url, phone);
      } catch (error) {
        const isWAHAError = error instanceof WAHAError;

        if (!isWAHAError) {
          throw new WAHAError(
            `Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`,
            WAHAErrorCode.UNKNOWN_ERROR,
            { requestUrl: url, phone }
          );
        }

        lastError = error as WAHAError;

        // Don't retry if not recoverable or no more attempts
        if (!error.isRecoverable || attempt >= retryAttempts) {
          throw error;
        }

        // Calculate backoff delay
        const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;
        const baseDelay = isTest ? 10 : Math.pow(2, attempt) * 1000;
        const jitter = isTest ? 0 : baseDelay * (0.1 + Math.random() * 0.1);
        const delay = baseDelay + jitter;

        logger.debug('Retrying WAHA request', {
          attempt: attempt + 1,
          maxAttempts: retryAttempts + 1,
          delay,
          error: error.message,
        });

        await this.sleep(delay);
      }
    }

    throw (
      lastError ||
      new WAHAError('Request failed after all retry attempts', WAHAErrorCode.UNKNOWN_ERROR, {
        requestUrl: url,
        phone,
      })
    );
  }

  /**
   * Make HTTP request with timeout
   * 🟢 WORKING: Handles request with AbortController timeout
   */
  private async makeRequest(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'X-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (fetchError) {
      clearTimeout(timeoutId);

      const isAbortError =
        (fetchError instanceof Error && fetchError.name === 'AbortError') ||
        (typeof DOMException !== 'undefined' &&
          fetchError instanceof DOMException &&
          fetchError.name === 'AbortError');

      if (isAbortError) {
        throw new WAHAError(
          `Request timeout after ${this.timeoutMs}ms`,
          WAHAErrorCode.TIMEOUT,
          { requestUrl: url, isRecoverable: true }
        );
      }

      throw new WAHAError(
        `Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown'}`,
        WAHAErrorCode.NETWORK_ERROR,
        { requestUrl: url, isRecoverable: true }
      );
    }
  }

  /**
   * Handle API response
   * 🟢 WORKING: Parses response and throws appropriate errors
   */
  private async handleResponse<T>(
    response: Response,
    url: string,
    phone: string
  ): Promise<T> {
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        return {} as T;
      }
    }

    // Handle error response
    let errorMessage = `HTTP ${response.status} error`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      // Ignore JSON parse errors
    }

    const errorCode = this.mapStatusCodeToErrorCode(response.status);
    const isRecoverable = RETRYABLE_STATUS_CODES.includes(response.status);

    throw new WAHAError(errorMessage, errorCode, {
      statusCode: response.status,
      requestUrl: url,
      phone,
      isRecoverable,
    });
  }

  /**
   * Map HTTP status code to WAHA error code
   * 🟢 WORKING: Comprehensive status code mapping
   */
  private mapStatusCodeToErrorCode(statusCode: number): WAHAErrorCode {
    switch (statusCode) {
      case 400:
        return WAHAErrorCode.VALIDATION_ERROR;
      case 401:
      case 403:
        return WAHAErrorCode.AUTHENTICATION_ERROR;
      case 503:
        return WAHAErrorCode.SESSION_NOT_READY;
      case 500:
      case 502:
      case 504:
        return WAHAErrorCode.SERVER_ERROR;
      default:
        return WAHAErrorCode.UNKNOWN_ERROR;
    }
  }

  /**
   * Format phone number for WAHA
   * 🟢 WORKING: Converts +27821234567 to 27821234567@c.us
   */
  private formatPhoneForWAHA(phone: string): string {
    // Remove + prefix and any non-numeric characters
    const cleanPhone = phone.replace(/[^\d]/g, '');
    return `${cleanPhone}@c.us`;
  }

  /**
   * Process message template
   * 🟢 WORKING: Substitutes variables in template
   */
  private processTemplate(
    templateId: string,
    variables: NotificationVariables
  ): string {
    const template = MESSAGE_TEMPLATES[templateId];

    if (!template) {
      throw new WAHAError(
        `Template not found: ${templateId}`,
        WAHAErrorCode.TEMPLATE_ERROR
      );
    }

    // Check required variables
    const missingVars = template.required_variables.filter(
      (varName) => !variables[varName]
    );

    if (missingVars.length > 0) {
      throw new WAHAError(
        `Missing required template variables: ${missingVars.join(', ')}`,
        WAHAErrorCode.TEMPLATE_ERROR
      );
    }

    // Substitute variables
    let message = template.template;
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined) {
        message = message.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
    }

    return message;
  }

  /**
   * Store notification in database
   * 🟢 WORKING: Inserts notification record
   */
  private async storeNotification(
    data: Omit<WhatsAppNotification, 'id' | 'created_at'>
  ): Promise<WhatsAppNotification> {
    const result = await query<WhatsAppNotification>(
      `INSERT INTO whatsapp_notifications (
        ticket_id, recipient_type, recipient_phone, recipient_name,
        message_template, message_content, status, waha_message_id,
        sent_at, delivered_at, read_at, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        data.ticket_id,
        data.recipient_type,
        data.recipient_phone,
        data.recipient_name,
        data.message_template,
        data.message_content,
        data.status,
        data.waha_message_id,
        data.sent_at || null,
        data.delivered_at || null,
        data.read_at || null,
        data.error_message || null,
      ]
    );

    if (!result || result.length === 0) {
      throw new Error('Failed to store notification in database');
    }

    return result[0];
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
 * Create a WhatsApp service instance
 * 🟢 WORKING: Validates configuration and creates service
 *
 * @param config - WAHA API configuration
 * @returns Configured WhatsApp service instance
 *
 * @example
 * const service = createWhatsAppService({
 *   base_url: process.env.WAHA_API_URL!,
 *   api_key: process.env.WAHA_API_KEY!,
 *   session_name: process.env.WAHA_SESSION_NAME!,
 *   timeout_ms: 10000,
 *   retry_attempts: 3,
 * });
 */
export function createWhatsAppService(config: WAHAConfig): WhatsAppService {
  return new WhatsAppService(config);
}

// ============================================================================
// Singleton Instance (Optional)
// ============================================================================

/**
 * Get the default WhatsApp service instance
 * 🟢 WORKING: Lazily creates singleton from environment variables
 */
let defaultService: WhatsAppService | null = null;

export function getDefaultWhatsAppService(): WhatsAppService {
  if (!defaultService) {
    const config: WAHAConfig = {
      base_url: process.env.WAHA_API_URL || '',
      api_key: process.env.WAHA_API_KEY || '',
      session_name: process.env.WAHA_SESSION_NAME || 'default',
      timeout_ms: parseInt(process.env.WAHA_TIMEOUT_MS || '30000', 10),
      retry_attempts: parseInt(process.env.WAHA_RETRY_ATTEMPTS || '3', 10),
    };

    defaultService = createWhatsAppService(config);
  }

  return defaultService;
}

/**
 * Reset the default service (for testing)
 * 🟢 WORKING: Clears singleton for test isolation
 */
export function resetDefaultWhatsAppService(): void {
  defaultService = null;
}
