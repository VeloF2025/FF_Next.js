/**
 * API: /api/ticketing/statuses
 *
 * GET - Fetch all active ticket statuses
 * POST - Create a new status (admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

interface TicketStatus {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  color: string;
  icon: string;
  display_order: number;
  is_active: boolean;
  is_terminal: boolean;
  qcontact_status: string | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const { include_inactive, parent_id } = req.query;

      let statuses: TicketStatus[];

      if (include_inactive === 'true') {
        if (parent_id) {
          statuses = (await sql`
            SELECT id, code, name, description, parent_id, color, icon, display_order, is_active, is_terminal, qcontact_status
            FROM ticket_statuses
            WHERE parent_id = ${parent_id as string}
            ORDER BY display_order, name
          `) as TicketStatus[];
        } else {
          statuses = (await sql`
            SELECT id, code, name, description, parent_id, color, icon, display_order, is_active, is_terminal, qcontact_status
            FROM ticket_statuses
            ORDER BY display_order, name
          `) as TicketStatus[];
        }
      } else {
        if (parent_id) {
          statuses = (await sql`
            SELECT id, code, name, description, parent_id, color, icon, display_order, is_active, is_terminal, qcontact_status
            FROM ticket_statuses
            WHERE is_active = true AND parent_id = ${parent_id as string}
            ORDER BY display_order, name
          `) as TicketStatus[];
        } else {
          statuses = (await sql`
            SELECT id, code, name, description, parent_id, color, icon, display_order, is_active, is_terminal, qcontact_status
            FROM ticket_statuses
            WHERE is_active = true
            ORDER BY display_order, name
          `) as TicketStatus[];
        }
      }

      return res.status(200).json({
        success: true,
        data: statuses,
        count: statuses.length,
      });
    } catch (error) {
      log.error('Failed to fetch ticket statuses', { error });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch ticket statuses',
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const { code, name, description, parent_id, color, icon, display_order, is_terminal, qcontact_status } = req.body;

      if (!code || !name) {
        return res.status(400).json({
          success: false,
          error: 'Code and name are required',
        });
      }

      const result = await sql`
        INSERT INTO ticket_statuses (code, name, description, parent_id, color, icon, display_order, is_terminal, qcontact_status)
        VALUES (
          ${code},
          ${name},
          ${description || null},
          ${parent_id || null},
          ${color || '#6B7280'},
          ${icon || 'circle'},
          ${display_order || 0},
          ${is_terminal || false},
          ${qcontact_status || null}
        )
        RETURNING *
      `;

      log.info('Created new ticket status', { code, name });

      return res.status(201).json({
        success: true,
        data: result[0],
      });
    } catch (error) {
      log.error('Failed to create ticket status', { error });
      return res.status(500).json({
        success: false,
        error: 'Failed to create ticket status',
      });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
