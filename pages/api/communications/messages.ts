/**
 * Internal Messages API
 * GET  - List inbox/sent/archived messages (paginated)
 * POST - Send a new message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authUser = (req as AuthenticatedNextApiRequest).user;
  const userId = authUser.id;

  if (req.method === 'GET') {
    return handleGet(req, res, userId);
  }

  if (req.method === 'POST') {
    return handlePost(req, res, userId, authUser.name || authUser.email);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  try {
    const view = (req.query.view as string) || 'inbox';
    const limit = Math.min(parseInt(req.query.limit as string || '20', 10) || 20, 100);
    const offset = parseInt(req.query.offset as string || '0', 10) || 0;
    const unreadOnly = req.query.unread_only === 'true';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    if (view === 'sent') {
      return search
        ? fetchSentSearch(res, userId, limit, offset, search)
        : fetchSent(res, userId, limit, offset);
    }

    if (view === 'archived') {
      return search
        ? fetchRecipientSearch(res, userId, limit, offset, true, search)
        : fetchRecipientView(res, userId, limit, offset, false, true);
    }

    // Default: inbox (not archived)
    if (search) {
      return fetchRecipientSearch(res, userId, limit, offset, false, search);
    }
    return fetchRecipientView(res, userId, limit, offset, unreadOnly, false);
  } catch (error) {
    log.error('Failed to fetch messages', { error }, 'Messages');
    return apiResponse.internalError(res, error);
  }
}

async function fetchRecipientView(
  res: NextApiResponse,
  userId: string,
  limit: number,
  offset: number,
  unreadOnly: boolean,
  archived: boolean
) {
  // Root messages only (thread_id IS NULL) where user is a recipient
  if (unreadOnly) {
    const messages = await sql`
      SELECT
        m.id, m.sender_id, m.subject, m.body, m.priority,
        m.thread_id, m.context_module, m.context_url, m.created_at,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) AS sender_name,
        u.email AS sender_email,
        r.is_read,
        (SELECT COUNT(*)::int FROM internal_messages WHERE thread_id = m.id) AS reply_count,
        (SELECT COUNT(*)::int FROM internal_message_recipients WHERE message_id = m.id) AS recipient_count,
        (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id) AS latest_reply_at
      FROM internal_messages m
      INNER JOIN internal_message_recipients r ON r.message_id = m.id AND r.recipient_id = ${userId}::uuid
      INNER JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id IS NULL
        AND r.is_archived = ${archived}
        AND r.is_read = FALSE
      ORDER BY COALESCE(
        (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id),
        m.created_at
      ) DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*)::int AS total
      FROM internal_messages m
      INNER JOIN internal_message_recipients r ON r.message_id = m.id AND r.recipient_id = ${userId}::uuid
      WHERE m.thread_id IS NULL
        AND r.is_archived = ${archived}
        AND r.is_read = FALSE
    `;

    return apiResponse.success(res, {
      messages,
      total: Number(countResult[0]?.total || 0),
    });
  }

  // All messages (read + unread)
  const messages = await sql`
    SELECT
      m.id, m.sender_id, m.subject, m.body, m.priority,
      m.thread_id, m.context_module, m.context_url, m.created_at,
      COALESCE(u.first_name || ' ' || u.last_name, u.email) AS sender_name,
      u.email AS sender_email,
      r.is_read,
      (SELECT COUNT(*)::int FROM internal_messages WHERE thread_id = m.id) AS reply_count,
      (SELECT COUNT(*)::int FROM internal_message_recipients WHERE message_id = m.id) AS recipient_count,
      (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id) AS latest_reply_at
    FROM internal_messages m
    INNER JOIN internal_message_recipients r ON r.message_id = m.id AND r.recipient_id = ${userId}::uuid
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.thread_id IS NULL
      AND r.is_archived = ${archived}
    ORDER BY COALESCE(
      (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id),
      m.created_at
    ) DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*)::int AS total
    FROM internal_messages m
    INNER JOIN internal_message_recipients r ON r.message_id = m.id AND r.recipient_id = ${userId}::uuid
    WHERE m.thread_id IS NULL
      AND r.is_archived = ${archived}
  `;

  return apiResponse.success(res, {
    messages,
    total: Number(countResult[0]?.total || 0),
  });
}

/**
 * Search branch for recipient (inbox / archived) views.
 * Completely separate query — no conditional SQL fragments.
 */
async function fetchRecipientSearch(
  res: NextApiResponse,
  userId: string,
  limit: number,
  offset: number,
  archived: boolean,
  search: string
) {
  const term = `%${search}%`;

  const messages = await sql`
    SELECT
      m.id, m.sender_id, m.subject, m.body, m.priority,
      m.thread_id, m.context_module, m.context_url, m.created_at,
      COALESCE(u.first_name || ' ' || u.last_name, u.email) AS sender_name,
      u.email AS sender_email,
      r.is_read,
      (SELECT COUNT(*)::int FROM internal_messages WHERE thread_id = m.id) AS reply_count,
      (SELECT COUNT(*)::int FROM internal_message_recipients WHERE message_id = m.id) AS recipient_count,
      (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id) AS latest_reply_at
    FROM internal_messages m
    INNER JOIN internal_message_recipients r ON r.message_id = m.id AND r.recipient_id = ${userId}::uuid
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.thread_id IS NULL
      AND r.is_archived = ${archived}
      AND (
        m.subject ILIKE ${term}
        OR m.body ILIKE ${term}
        OR COALESCE(u.first_name || ' ' || u.last_name, u.email) ILIKE ${term}
      )
    ORDER BY COALESCE(
      (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id),
      m.created_at
    ) DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*)::int AS total
    FROM internal_messages m
    INNER JOIN internal_message_recipients r ON r.message_id = m.id AND r.recipient_id = ${userId}::uuid
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.thread_id IS NULL
      AND r.is_archived = ${archived}
      AND (
        m.subject ILIKE ${term}
        OR m.body ILIKE ${term}
        OR COALESCE(u.first_name || ' ' || u.last_name, u.email) ILIKE ${term}
      )
  `;

  return apiResponse.success(res, {
    messages,
    total: Number(countResult[0]?.total || 0),
  });
}

/**
 * Search branch for sent view.
 * Completely separate query — no conditional SQL fragments.
 */
async function fetchSentSearch(
  res: NextApiResponse,
  userId: string,
  limit: number,
  offset: number,
  search: string
) {
  const term = `%${search}%`;

  const messages = await sql`
    SELECT
      m.id, m.sender_id, m.subject, m.body, m.priority,
      m.thread_id, m.context_module, m.context_url, m.created_at,
      COALESCE(u.first_name || ' ' || u.last_name, u.email) AS sender_name,
      u.email AS sender_email,
      TRUE AS is_read,
      (SELECT COUNT(*)::int FROM internal_messages WHERE thread_id = m.id) AS reply_count,
      (SELECT COUNT(*)::int FROM internal_message_recipients WHERE message_id = m.id) AS recipient_count,
      (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id) AS latest_reply_at
    FROM internal_messages m
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.sender_id = ${userId}::uuid
      AND m.thread_id IS NULL
      AND (
        m.subject ILIKE ${term}
        OR m.body ILIKE ${term}
      )
    ORDER BY m.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*)::int AS total
    FROM internal_messages m
    WHERE m.sender_id = ${userId}::uuid
      AND m.thread_id IS NULL
      AND (
        m.subject ILIKE ${term}
        OR m.body ILIKE ${term}
      )
  `;

  return apiResponse.success(res, {
    messages,
    total: Number(countResult[0]?.total || 0),
  });
}

async function fetchSent(
  res: NextApiResponse,
  userId: string,
  limit: number,
  offset: number
) {
  const messages = await sql`
    SELECT
      m.id, m.sender_id, m.subject, m.body, m.priority,
      m.thread_id, m.context_module, m.context_url, m.created_at,
      COALESCE(u.first_name || ' ' || u.last_name, u.email) AS sender_name,
      u.email AS sender_email,
      TRUE AS is_read,
      (SELECT COUNT(*)::int FROM internal_messages WHERE thread_id = m.id) AS reply_count,
      (SELECT COUNT(*)::int FROM internal_message_recipients WHERE message_id = m.id) AS recipient_count,
      (SELECT MAX(created_at) FROM internal_messages WHERE thread_id = m.id) AS latest_reply_at
    FROM internal_messages m
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.sender_id = ${userId}::uuid
      AND m.thread_id IS NULL
    ORDER BY m.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*)::int AS total
    FROM internal_messages m
    WHERE m.sender_id = ${userId}::uuid
      AND m.thread_id IS NULL
  `;

  return apiResponse.success(res, {
    messages,
    total: Number(countResult[0]?.total || 0),
  });
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string,
  senderName: string
) {
  try {
    const { recipients, subject, body, priority, threadId, contextModule, contextId, contextUrl } = req.body;

    if (!body || typeof body !== 'string' || !body.trim()) {
      return apiResponse.badRequest(res, 'Message body is required');
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return apiResponse.badRequest(res, 'At least one recipient is required');
    }

    // Insert message
    const messageRows = await sql`
      INSERT INTO internal_messages (
        sender_id, subject, body, priority,
        thread_id, context_module, context_id, context_url
      ) VALUES (
        ${userId}::uuid,
        ${subject?.trim() || null},
        ${body.trim()},
        ${priority || 'normal'},
        ${threadId || null},
        ${contextModule || null},
        ${contextId || null},
        ${contextUrl || null}
      )
      RETURNING *
    `;

    const message = messageRows[0];

    // Insert recipients
    for (const recipientId of recipients) {
      await sql`
        INSERT INTO internal_message_recipients (message_id, recipient_id)
        VALUES (${message.id}, ${recipientId}::uuid)
        ON CONFLICT (message_id, recipient_id) DO NOTHING
      `;
    }

    // Trigger notifications (fire-and-forget)
    const notifSubject = subject?.trim() || body.trim().substring(0, 100);
    notify({
      event_type: 'messaging.new_message',
      title: `${senderName} sent you a message`,
      body: notifSubject,
      icon: 'mail',
      severity: priority === 'urgent' ? 'warning' : 'info',
      action_url: '/communications?tab=inbox',
      source_module: 'messaging',
      source_id: message.id,
      recipient_user_ids: recipients,
    }).catch(err => {
      log.error('Failed to send message notification', { error: err }, 'Messages');
    });

    log.info('Internal message sent', {
      messageId: message.id,
      sender: userId,
      recipientCount: recipients.length,
      isReply: !!threadId,
    }, 'Messages');

    return apiResponse.created(res, message, 'Message sent');
  } catch (error) {
    log.error('Failed to send message', { error }, 'Messages');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
