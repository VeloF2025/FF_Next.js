/**
 * Email types for Communications Hub
 */

export type EmailStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'bounced';

export interface EmailOutboxItem {
  id: string;
  sender_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  source_module: string;
  source_id: string | null;
  status: EmailStatus;
  resend_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  // Joined fields
  sender_name?: string;
  sender_email?: string;
}

export interface EmailComposePayload {
  to: string;
  toName?: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}

export interface EmailOutboxFilters {
  status?: EmailStatus;
  sourceModule?: string;
  limit?: number;
  offset?: number;
}
