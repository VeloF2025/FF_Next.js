/**
 * API Route: /api/technicians/discover
 *
 * Discover technicians from WhatsApp submissions that haven't
 * been added to the wa_contacts directory yet.
 *
 * GET - List discovered technicians not yet in directory
 * POST - Import selected technicians to directory
 *
 * @updated 2026-02-05 - Now uses wa_contacts table
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import type { DiscoveredTechnician } from '@/types/technician.types';

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case 'GET':
        return handleDiscover(req, res);
      case 'POST':
        return handleImport(req, res);
      default:
        return apiResponse.methodNotAllowed(res, ['GET', 'POST']);
    }
  } catch (error) {
    log.error('TechniciansDiscoverAPI', 'Request failed', { error });
    return apiResponse.serverError(res, 'Internal server error');
  }
}

async function handleDiscover(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  // Discover WhatsApp senders not yet in wa_contacts
  const result = await pool.query(`
    SELECT
      qpr.sender_phone as identifier,
      qpr.sender_phone,
      qpr.user_name as sample_name,
      COUNT(DISTINCT qpr.drop_number) as submission_count,
      MAX(COALESCE(qpr.whatsapp_message_date, qpr.created_at)) as last_seen,
      ARRAY_AGG(DISTINCT qpr.project) FILTER (WHERE qpr.project IS NOT NULL) as projects,
      CASE WHEN wc.id IS NOT NULL THEN true ELSE false END as already_linked
    FROM qa_photo_reviews qpr
    LEFT JOIN wa_contacts wc ON qpr.sender_phone = wc.sender_phone
    WHERE qpr.sender_phone IS NOT NULL
      AND qpr.sender_phone != ''
    GROUP BY qpr.sender_phone, qpr.user_name, wc.id
    HAVING COUNT(DISTINCT qpr.drop_number) >= 1
    ORDER BY COUNT(DISTINCT qpr.drop_number) DESC
    LIMIT 100
  `);

  const discoveries: DiscoveredTechnician[] = result.rows.map(row => ({
    identifier: row.identifier,
    source: 'whatsapp' as const,
    sampleName: row.sample_name || formatPhoneDisplay(row.sender_phone),
    submissionCount: parseInt(row.submission_count),
    lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : '',
    projects: row.projects || [],
    alreadyLinked: row.already_linked || false,
  }));

  const unlinked = discoveries.filter(d => !d.alreadyLinked);
  const linked = discoveries.filter(d => d.alreadyLinked);

  return apiResponse.success(res, {
    discovered: unlinked,
    alreadyLinked: linked,
    total: discoveries.length,
  });
}

async function handleImport(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { technicians } = req.body;

  if (!Array.isArray(technicians) || technicians.length === 0) {
    return apiResponse.badRequest(res, 'technicians array is required');
  }

  const imported: { id: string; sender_phone: string }[] = [];
  const errors: { identifier: string; error: string }[] = [];

  for (const tech of technicians) {
    try {
      const { identifier, name, type, projects } = tech;

      // identifier is the phone number for WhatsApp
      const result = await pool.query(
        `INSERT INTO wa_contacts (
          sender_phone, wa_display_name, formal_name, role, projects, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (sender_phone) DO UPDATE SET
          wa_display_name = COALESCE(wa_contacts.wa_display_name, EXCLUDED.wa_display_name),
          projects = EXCLUDED.projects
        RETURNING id, sender_phone`,
        [
          identifier,
          name || null,
          name || null,
          type || 'activator',
          projects || [],
          req.user?.username || 'api',
        ]
      );

      if (result.rows[0]) {
        imported.push(result.rows[0]);
      }
    } catch (err) {
      errors.push({ identifier: tech.identifier, error: (err as Error).message });
    }
  }

  log.info('TechniciansDiscoverAPI', `Imported ${imported.length} technicians`, {
    total: technicians.length,
    errors: errors.length,
  });

  return apiResponse.success(res, {
    imported,
    errors,
    summary: {
      requested: technicians.length,
      imported: imported.length,
      failed: errors.length,
    },
  });
}

function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return 'Unknown';
  // Clean up phone format for display
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.length > 10) {
    return `+${cleaned.slice(-12)}`;
  }
  return cleaned;
}

export default withAuth(handler);
