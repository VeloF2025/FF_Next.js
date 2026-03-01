/**
 * GET /api/communications/feed
 * Unified feed API — queries messages, email outbox, notifications, and
 * meeting action items in parallel, normalizes to FeedItem[], merges
 * chronologically, and paginates.
 *
 * Query params:
 *   limit    — 1..50 (default 30)
 *   offset   — number (default 0)
 *   channels — comma-separated: message,email,notification,meeting (default: all)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { FeedItem } from '@/modules/communications/types/hub.types';

const sql = neon(process.env.DATABASE_URL!);

type Channel = 'message' | 'email' | 'notification' | 'meeting';
const ALL_CHANNELS: Channel[] = ['message', 'email', 'notification', 'meeting'];

// ---------------------------------------------------------------------------
// Channel query helpers
// ---------------------------------------------------------------------------

async function fetchMessages(userId: string): Promise<FeedItem[]> {
  const rows = await sql`
    SELECT
      m.id,
      m.subject,
      m.body,
      m.priority,
      m.context_module,
      m.created_at,
      u.first_name || ' ' || u.last_name AS sender_name,
      r.is_read,
      (
        SELECT COUNT(*)::int FROM internal_messages sub
        WHERE sub.thread_id = m.id
      ) AS reply_count,
      (
        SELECT MAX(sub.created_at) FROM internal_messages sub
        WHERE sub.thread_id = m.id
      ) AS latest_reply_at
    FROM internal_messages m
    JOIN internal_message_recipients r
      ON r.message_id = m.id AND r.recipient_id = ${userId}::uuid
    JOIN users u ON u.id = m.sender_id
    WHERE m.thread_id IS NULL
      AND r.is_archived = FALSE
    ORDER BY COALESCE(
      (SELECT MAX(sub.created_at) FROM internal_messages sub WHERE sub.thread_id = m.id),
      m.created_at
    ) DESC
    LIMIT 50
  `;

  return rows.map((r): FeedItem => ({
    id: r.id,
    channel: 'message',
    title: r.subject || r.sender_name,
    body: r.body ? String(r.body).slice(0, 200) : null,
    timestamp: r.latest_reply_at || r.created_at,
    isRead: !!r.is_read,
    actionUrl: '/communications?tab=inbox',
    sourceModule: r.context_module || 'messaging',
    sourceId: r.id,
    metadata: {
      priority: r.priority,
      reply_count: Number(r.reply_count),
      sender_name: r.sender_name,
    },
  }));
}

async function fetchEmails(userId: string): Promise<FeedItem[]> {
  const rows = await sql`
    SELECT
      e.id,
      e.subject,
      e.recipient_email,
      e.recipient_name,
      e.source_module,
      e.status,
      e.sent_at,
      e.created_at
    FROM email_outbox e
    WHERE e.sender_id = ${userId}::uuid
    ORDER BY e.created_at DESC
    LIMIT 50
  `;

  return rows.map((r): FeedItem => ({
    id: r.id,
    channel: 'email',
    title: r.subject,
    body: r.recipient_name
      ? `To: ${r.recipient_name} <${r.recipient_email}>`
      : `To: ${r.recipient_email}`,
    timestamp: r.sent_at || r.created_at,
    isRead: true, // Sent by user
    actionUrl: null,
    sourceModule: r.source_module || 'email',
    sourceId: r.id,
    metadata: {
      status: r.status,
      recipient_name: r.recipient_name,
      recipient_email: r.recipient_email,
    },
  }));
}

async function fetchNotifications(userId: string): Promise<FeedItem[]> {
  const rows = await sql`
    SELECT
      n.id,
      n.title,
      n.body,
      n.icon,
      n.severity,
      n.event_type,
      n.action_url,
      n.source_module,
      n.source_id,
      n.is_read,
      n.created_at
    FROM user_notifications n
    WHERE n.user_id = ${userId}::uuid
      AND n.event_type != 'messaging.new_message'
    ORDER BY n.created_at DESC
    LIMIT 50
  `;

  return rows.map((r): FeedItem => ({
    id: r.id,
    channel: 'notification',
    title: r.title,
    body: r.body ? String(r.body).slice(0, 200) : null,
    timestamp: r.created_at,
    isRead: !!r.is_read,
    actionUrl: r.action_url || null,
    sourceModule: r.source_module || null,
    sourceId: r.source_id || null,
    metadata: {
      severity: r.severity,
      event_type: r.event_type,
      icon: r.icon,
    },
  }));
}

async function fetchMeetingActions(
  userId: string,
  userEmail: string
): Promise<FeedItem[]> {
  const rows = await sql`
    SELECT
      ai.id,
      ai.description,
      ai.assignee_name,
      ai.status::text AS status,
      ai.priority::text AS priority,
      ai.due_date,
      ai.created_at,
      m.title AS meeting_title
    FROM meeting_action_items ai
    LEFT JOIN meetings m ON ai.meeting_id = m.id
    WHERE (ai.assignee_email = ${userEmail} OR ai.created_by = ${userId}::uuid)
      AND ai.status::text IN ('pending', 'in_progress')
    ORDER BY ai.created_at DESC
    LIMIT 50
  `;

  return rows.map((r): FeedItem => ({
    id: r.id,
    channel: 'meeting',
    title: r.description ? String(r.description).slice(0, 120) : 'Action item',
    body: r.meeting_title
      ? `${r.meeting_title}${r.due_date ? ` — Due: ${new Date(r.due_date).toLocaleDateString('en-ZA')}` : ''}`
      : null,
    timestamp: r.created_at,
    isRead: r.status !== 'pending',
    actionUrl: '/action-items',
    sourceModule: 'meetings',
    sourceId: r.id,
    metadata: {
      priority: r.priority,
      status: r.status,
      due_date: r.due_date,
      assignee: r.assignee_name,
    },
  }));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const authUser = (req as AuthenticatedNextApiRequest).user;
  const userId = authUser.id;
  const userEmail = authUser.email;

  try {
    // Parse params
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '30'), 10) || 30, 1),
      50
    );
    const offset = Math.max(
      parseInt(String(req.query.offset || '0'), 10) || 0,
      0
    );

    const channelsParam = String(req.query.channels || '').trim();
    const requestedChannels: Channel[] = channelsParam
      ? (channelsParam.split(',').filter(c => ALL_CHANNELS.includes(c as Channel)) as Channel[])
      : ALL_CHANNELS;

    if (requestedChannels.length === 0) {
      return apiResponse.success(res, {
        items: [],
        total: 0,
        counts: { message: 0, email: 0, notification: 0, meeting: 0 },
      });
    }

    // Fetch all active channels in parallel
    const fetchers: Record<Channel, () => Promise<FeedItem[]>> = {
      message: () => fetchMessages(userId),
      email: () => fetchEmails(userId),
      notification: () => fetchNotifications(userId),
      meeting: () => fetchMeetingActions(userId, userEmail),
    };

    const results = await Promise.all(
      requestedChannels.map(async (ch) => ({
        channel: ch,
        items: await fetchers[ch](),
      }))
    );

    // Build per-channel counts
    const counts = { message: 0, email: 0, notification: 0, meeting: 0 };
    const allItems: FeedItem[] = [];

    for (const { channel, items } of results) {
      counts[channel] = items.length;
      allItems.push(...items);
    }

    // Sort by timestamp DESC
    allItems.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const total = allItems.length;
    const paginated = allItems.slice(offset, offset + limit);

    return apiResponse.success(res, {
      items: paginated,
      total,
      counts,
    });
  } catch (error) {
    log.error('Failed to fetch unified feed', { error }, 'CommunicationsFeed');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
