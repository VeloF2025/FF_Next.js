/**
 * API Route: /api/technicians/discover
 * 
 * Discover technicians from WhatsApp submissions and OneMap data
 * that haven't been added to the directory yet.
 * 
 * GET - List discovered technicians not yet in directory
 * POST - Import selected technicians to directory
 * 
 * @author Jarvis
 * @date 2026-02-01
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { DiscoveredTechnician } from '@/types/technician.types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') ? { rejectUnauthorized: false } : undefined,
});

const ONEMAP_API = process.env.ONEMAP_API_URL || 'http://100.96.203.105:8003';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method === 'GET') {
      return handleDiscover(req, res);
    } else if (req.method === 'POST') {
      return handleImport(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    log.error('TechniciansDiscoverAPI', 'Request failed', { error });
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    });
  }
}

async function handleDiscover(req: NextApiRequest, res: NextApiResponse) {
  const { source } = req.query;
  const discoveries: DiscoveredTechnician[] = [];

  // Discover from WhatsApp
  if (!source || source === 'whatsapp' || source === 'all') {
    const waResult = await pool.query(`
      WITH existing AS (
        SELECT wa_sender_jid, phone FROM technicians 
        WHERE wa_sender_jid IS NOT NULL OR phone IS NOT NULL
      ),
      senders AS (
        SELECT 
          COALESCE(qpr.wa_sender_jid, qpr.sender_phone) as identifier,
          qpr.sender_phone,
          qpr.wa_sender_jid,
          qpr.wa_group_jid,
          COUNT(DISTINCT qpr.drop_number) as submission_count,
          MAX(qpr.whatsapp_message_date) as last_seen,
          ARRAY_AGG(DISTINCT qpr.project) FILTER (WHERE qpr.project IS NOT NULL) as projects
        FROM qa_photo_reviews qpr
        WHERE qpr.sender_phone IS NOT NULL OR qpr.wa_sender_jid IS NOT NULL
        GROUP BY COALESCE(qpr.wa_sender_jid, qpr.sender_phone), qpr.sender_phone, qpr.wa_sender_jid, qpr.wa_group_jid
        HAVING COUNT(DISTINCT qpr.drop_number) >= 2
      )
      SELECT 
        s.*,
        CASE 
          WHEN e.wa_sender_jid IS NOT NULL THEN true
          WHEN e.phone IS NOT NULL AND s.sender_phone IS NOT NULL 
            AND RIGHT(REGEXP_REPLACE(e.phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(s.sender_phone, '[^0-9]', '', 'g'), 10) 
          THEN true
          ELSE false
        END as already_linked
      FROM senders s
      LEFT JOIN existing e ON (
        s.wa_sender_jid = e.wa_sender_jid
        OR (s.sender_phone IS NOT NULL AND e.phone IS NOT NULL 
            AND RIGHT(REGEXP_REPLACE(e.phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(s.sender_phone, '[^0-9]', '', 'g'), 10))
      )
      ORDER BY s.submission_count DESC
      LIMIT 50
    `);

    for (const row of waResult.rows) {
      discoveries.push({
        identifier: row.identifier,
        source: 'whatsapp',
        sampleName: formatPhoneDisplay(row.sender_phone),
        submissionCount: parseInt(row.submission_count),
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : '',
        projects: row.projects || [],
        alreadyLinked: row.already_linked || false,
      });
    }
  }

  // Discover from OneMap (if requested)
  if (source === 'onemap' || source === 'all') {
    try {
      // Query OneMap for unique installer names
      // This would need to be implemented based on OneMap API
      // For now, we'll scan recent DRs for installer_name
      const onemapResult = await pool.query(`
        WITH existing AS (
          SELECT onemap_installer_name FROM technicians 
          WHERE onemap_installer_name IS NOT NULL
        )
        SELECT 
          upr.installer_name,
          COUNT(DISTINCT upr.drop_number) as submission_count,
          MAX(upr.created_at) as last_seen,
          ARRAY_AGG(DISTINCT upr.project) FILTER (WHERE upr.project IS NOT NULL) as projects
        FROM dr_photo_unified_reviews upr
        WHERE upr.installer_name IS NOT NULL 
          AND upr.installer_name != ''
          AND upr.installer_name NOT IN (SELECT onemap_installer_name FROM existing)
        GROUP BY upr.installer_name
        HAVING COUNT(DISTINCT upr.drop_number) >= 2
        ORDER BY submission_count DESC
        LIMIT 50
      `);

      for (const row of onemapResult.rows) {
        discoveries.push({
          identifier: row.installer_name,
          source: 'onemap',
          sampleName: row.installer_name,
          submissionCount: parseInt(row.submission_count),
          lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : '',
          projects: row.projects || [],
          alreadyLinked: false,
        });
      }
    } catch (err) {
      log.warn('TechniciansDiscoverAPI', 'OneMap discovery failed', { error: err });
    }
  }

  // Filter out already linked
  const unlinked = discoveries.filter(d => !d.alreadyLinked);
  const linked = discoveries.filter(d => d.alreadyLinked);

  return res.status(200).json({ 
    discovered: unlinked,
    alreadyLinked: linked,
    total: discoveries.length,
  });
}

async function handleImport(req: NextApiRequest, res: NextApiResponse) {
  const { technicians } = req.body;

  if (!Array.isArray(technicians) || technicians.length === 0) {
    return res.status(400).json({ error: 'technicians array is required' });
  }

  const imported: any[] = [];
  const errors: any[] = [];

  for (const tech of technicians) {
    try {
      const { identifier, source, name, type, contractor, projects } = tech;
      
      if (!name || !type) {
        errors.push({ identifier, error: 'name and type are required' });
        continue;
      }

      const isWhatsApp = source === 'whatsapp';
      const isOnemap = source === 'onemap';

      const result = await pool.query(
        `INSERT INTO technicians (
          name, phone, type, wa_sender_jid, onemap_installer_name, 
          contractor, projects, discovered_from, discovered_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT DO NOTHING
        RETURNING *`,
        [
          name,
          isWhatsApp && identifier.includes('+') ? identifier : null,
          type || (isWhatsApp ? 'activator' : 'installer'),
          isWhatsApp && !identifier.includes('+') ? identifier : null,
          isOnemap ? identifier : null,
          contractor,
          projects || [],
          source,
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
    errors: errors.length 
  });

  return res.status(200).json({ 
    imported,
    errors,
    summary: {
      requested: technicians.length,
      imported: imported.length,
      failed: errors.length,
    }
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
