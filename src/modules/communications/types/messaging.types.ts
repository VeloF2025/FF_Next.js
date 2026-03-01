/**
 * Internal Messaging Types
 * Communications Hub Phase 3
 */

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageView = 'inbox' | 'sent' | 'archived';

export interface MessageListItem {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_email: string;
  subject: string | null;
  body: string;
  priority: MessagePriority;
  thread_id: string | null;
  context_module: string | null;
  context_url: string | null;
  is_read: boolean;
  reply_count: number;
  recipient_count: number;
  latest_reply_at: string | null;
  created_at: string;
}

export interface MessageDetail extends MessageListItem {
  recipients: MessageRecipient[];
  context_id: string | null;
}

export interface MessageRecipient {
  id: string;
  name: string;
  email: string;
  is_read: boolean;
}

export interface ThreadMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_email: string;
  body: string;
  created_at: string;
}

export interface ComposeMessagePayload {
  recipients: string[];
  subject?: string;
  body: string;
  priority?: MessagePriority;
  threadId?: string;
  contextModule?: string;
  contextId?: string;
  contextUrl?: string;
}

export interface UserOption {
  id: string;
  name: string;
  email: string;
  department: string | null;
}
