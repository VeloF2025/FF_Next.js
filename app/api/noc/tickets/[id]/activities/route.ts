import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import {
  FiberTimeQContactClient,
  QContactActivity,
} from '@/modules/noc/services/fibertimeQContactClient';

const logger = createLogger('ticket-activities-api');

const sql = neon(process.env.DATABASE_URL!);

// QContact client configuration from environment (uses FIBERTIME_QCONTACT_* prefix)
const qcontactConfig = {
  baseUrl: process.env.FIBERTIME_QCONTACT_BASE_URL || 'https://fibertime.qcontact.com',
  uid: process.env.FIBERTIME_QCONTACT_UID || '',
  accessToken: process.env.FIBERTIME_QCONTACT_ACCESS_TOKEN || '',
  client: process.env.FIBERTIME_QCONTACT_CLIENT || '',
  password: process.env.FIBERTIME_QCONTACT_PASSWORD || '', // For auto-refresh on 401
};

interface TicketActivity {
  id: string;
  type: 'note' | 'update' | 'status_change' | 'assignment' | 'message' | 'system' | 'ai_summary';
  description: string | null;
  field_changes:
    | { field: string; old_value?: string; new_value: string }[]
    | { facts?: unknown; model?: string; latency_ms?: number; [k: string]: unknown }
    | null;
  created_by: { name: string; email?: string } | null;
  created_at: string;
  source: 'qcontact' | 'fibreflow';
  is_private: boolean;
  is_pinned: boolean;
}

/**
 * Cache QContact activities locally for persistence
 * Uses UPSERT to avoid duplicates based on external_id
 */
async function cacheQContactActivities(
  ticketId: string,
  activities: QContactActivity[]
): Promise<void> {
  if (activities.length === 0) return;

  logger.debug('Caching QContact activities', { ticketId, count: activities.length });

  for (const activity of activities) {
    try {
      // Use external_id to detect duplicates
      const externalId = `qc-${activity.id}`;

      // Check if already cached
      const existing = await sql`
        SELECT id FROM maintenance_activities
        WHERE ticket_id = ${ticketId} AND external_id = ${externalId}
      `;

      if (existing.length > 0) {
        // Already cached, skip
        continue;
      }

      // Insert new activity
      await sql`
        INSERT INTO maintenance_activities (
          id,
          ticket_id,
          external_id,
          activity_type,
          description,
          field_changes,
          created_by_name,
          created_by_email,
          source,
          external_timestamp,
          created_at
        ) VALUES (
          gen_random_uuid(),
          ${ticketId},
          ${externalId},
          ${activity.type},
          ${activity.description},
          ${activity.field_changes ? JSON.stringify(activity.field_changes) : null}::jsonb,
          ${activity.created_by?.name || null},
          ${activity.created_by?.email || null},
          'qcontact',
          ${activity.created_at}::timestamptz,
          NOW()
        )
      `;
    } catch (err) {
      logger.warn('Failed to cache individual activity', {
        ticketId,
        activityId: activity.id,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  logger.info('Cached QContact activities', { ticketId, count: activities.length });
}

/**
 * GET /api/noc/tickets/[id]/activities
 * Fetch all activities for a ticket from both QContact and local database
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;

    if (!ticketId) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket ID is required' } },
        { status: 400 }
      );
    }

    logger.debug('Fetching activities for ticket', { ticketId });

    // Get the ticket to find QContact case ID (stored as external_id for qcontact source)
    const tickets = await sql`
      SELECT id, source, external_id, dr_number
      FROM maintenance_tickets
      WHERE id = ${ticketId}
    `;

    if (tickets.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket not found' } },
        { status: 404 }
      );
    }

    const ticket = tickets[0]!;
    const activities: TicketActivity[] = [];

    // Fetch QContact activities if this is a QContact ticket with external_id
    const qcontactCaseId = ticket.source === 'qcontact' ? ticket.external_id : null;
    let qcontactActivitiesFetched = false;

    if (qcontactCaseId && qcontactConfig.accessToken) {
      try {
        const qcontactClient = new FiberTimeQContactClient(qcontactConfig);
        const qcontactResponse = await qcontactClient.getCaseActivities(
          Number(qcontactCaseId)
        );

        // Map QContact activities to our format
        for (const activity of qcontactResponse.activities) {
          activities.push({
            ...activity,
            source: 'qcontact' as const,
          });
        }

        qcontactActivitiesFetched = true;

        // Cache QContact activities locally for persistence
        // This runs in background to not slow down response
        cacheQContactActivities(ticketId, qcontactResponse.activities).catch((err) => {
          logger.warn('Failed to cache QContact activities', {
            ticketId,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });

        logger.debug('Fetched QContact activities', {
          ticketId,
          count: qcontactResponse.activities.length,
        });
      } catch (error) {
        logger.warn('Failed to fetch QContact activities, will use cached data', {
          ticketId,
          qcontactCaseId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with local cached activities
      }
    }

    // Fetch local activities from database
    // If QContact was fetched successfully, only load non-QContact local activities (to avoid duplicates)
    // If QContact failed, load ALL local activities (including cached QContact ones)
    try {
      const localActivities = qcontactActivitiesFetched
        ? await sql`
            SELECT
              id,
              external_id,
              activity_type,
              description,
              field_changes,
              created_by_name,
              created_by_email,
              source,
              external_timestamp,
              created_at
            FROM maintenance_activities
            WHERE ticket_id = ${ticketId}
              AND (source IS NULL OR source != 'qcontact')
            ORDER BY COALESCE(external_timestamp, created_at) DESC
          `
        : await sql`
            SELECT
              id,
              external_id,
              activity_type,
              description,
              field_changes,
              created_by_name,
              created_by_email,
              source,
              external_timestamp,
              created_at
            FROM maintenance_activities
            WHERE ticket_id = ${ticketId}
            ORDER BY COALESCE(external_timestamp, created_at) DESC
          `;

      for (const activity of localActivities) {
        activities.push({
          id: activity.id,
          type: (activity.activity_type || 'note') as TicketActivity['type'],
          description: activity.description,
          field_changes: activity.field_changes,
          created_by: activity.created_by_name
            ? { name: activity.created_by_name, email: activity.created_by_email }
            : null,
          created_at: activity.external_timestamp || activity.created_at,
          source: (activity.source || 'fibreflow') as 'qcontact' | 'fibreflow',
          is_private: false,
          is_pinned: false,
        });
      }

      logger.debug('Fetched local activities', {
        ticketId,
        count: localActivities.length,
      });
    } catch (error) {
      // Table might not exist yet, continue without local activities
      logger.debug('No local activities table or error fetching', {
        ticketId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Sort all activities by date (newest first)
    activities.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA;
    });

    // Parse URL for filtering options
    const { searchParams } = new URL(request.url);
    const filterType = searchParams.get('type');
    const filterSource = searchParams.get('source');

    let filteredActivities = activities;

    // Apply type filter if specified
    if (filterType) {
      filteredActivities = filteredActivities.filter((a) => a.type === filterType);
    }

    // Apply source filter if specified
    if (filterSource && (filterSource === 'qcontact' || filterSource === 'fibreflow')) {
      filteredActivities = filteredActivities.filter((a) => a.source === filterSource);
    }

    // Calculate summary counts
    const summary = {
      notes: activities.filter((a) => a.type === 'note').length,
      updates: activities.filter((a) => a.type === 'update' || a.type === 'status_change').length,
      messages: activities.filter((a) => a.type === 'message').length,
      system: activities.filter((a) => a.type === 'system' || a.type === 'assignment').length,
      total: activities.length,
    };

    // Check if any activities came from QContact
    const hasQContact = activities.some((a) => a.source === 'qcontact');

    return NextResponse.json({
      success: true,
      data: {
        activities: filteredActivities,
        summary,
        has_qcontact: hasQContact,
      },
    });
  } catch (error) {
    logger.error('Error fetching ticket activities', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { success: false, error: { message: 'Failed to fetch activities' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/noc/tickets/[id]/activities
 * Create a new activity (note) for a ticket
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;

    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { type = 'note', description, created_by, is_private = false } = body;

    if (!description) {
      return NextResponse.json(
        { error: 'Description is required' },
        { status: 400 }
      );
    }

    // Verify ticket exists
    const tickets = await sql`
      SELECT id FROM maintenance_tickets WHERE id = ${ticketId}
    `;

    if (tickets.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Create the activity
    const activityId = crypto.randomUUID();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO maintenance_activities (
        id, ticket_id, type, description, created_by, created_at, is_private, is_pinned
      ) VALUES (
        ${activityId},
        ${ticketId},
        ${type},
        ${description},
        ${JSON.stringify(created_by || { name: 'System' })},
        ${now},
        ${is_private},
        false
      )
    `;

    logger.debug('Created ticket activity', { ticketId, activityId, type });

    return NextResponse.json({
      id: activityId,
      type,
      description,
      created_by: created_by || { name: 'System' },
      created_at: now,
      source: 'fibreflow',
      is_private,
      is_pinned: false,
    });
  } catch (error) {
    logger.error('Error creating ticket activity', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to create activity' },
      { status: 500 }
    );
  }
}
