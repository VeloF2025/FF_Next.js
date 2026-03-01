/**
 * Communications Hub Type Definitions
 * Types for the unified communications hub (Phase 1+)
 */

/** Tab identifiers for the Communications Hub */
export type CommsTab = 'inbox' | 'email' | 'whatsapp' | 'meetings' | 'notifications' | 'settings';

/** Stats displayed in the hub header */
export interface CommsStats {
  unreadNotifications: number;
  unreadMessages: number;
  totalMeetings: number;
  pendingActions: number;
}

/** Unified feed item for the Inbox tab (Phase 4) */
export interface FeedItem {
  id: string;
  channel: 'notification' | 'email' | 'whatsapp' | 'meeting' | 'message';
  title: string;
  body: string | null;
  timestamp: string;
  isRead: boolean;
  actionUrl: string | null;
  sourceModule: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown>;
}
