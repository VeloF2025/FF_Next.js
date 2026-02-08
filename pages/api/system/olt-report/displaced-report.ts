/**
 * Displaced ONT Report API
 *
 * GET: Returns all displaced ONT records from serial_change_history
 *      with activation status from backfilled metadata.
 *
 * Query params:
 * - filter: 'all' | 'unactivated' | 'activated' (default: 'all')
 * - format: 'json' | 'csv' (default: 'json')
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import pool from '@/lib/db';
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';


async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const filter = (req.query.filter as string) || 'all';
  const format = (req.query.format as string) || 'json';

  try {
    // Build WHERE clause for filter
    let filterClause = '';
    if (filter === 'unactivated') {
      filterClause = "AND (metadata->>'displaced_activated')::boolean = false";
    } else if (filter === 'activated') {
      filterClause = "AND (metadata->>'displaced_activated')::boolean = true";
    }

    const result = await pool.query(`
      SELECT drop_number, old_value, new_value, created_at,
             metadata->>'displaced_serial' as displaced_serial,
             (metadata->>'displaced_activated')::boolean as displaced_activated,
             metadata->>'displaced_owner_dr' as displaced_owner_dr,
             metadata->>'displaced_owner_team' as displaced_owner_team
      FROM serial_change_history
      WHERE change_type = 'ont_serial'
        AND metadata->>'displaced_serial' IS NOT NULL
        ${filterClause}
      ORDER BY created_at DESC
      LIMIT 500
    `);

    // Get summary counts
    const counts = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE (metadata->>'displaced_activated')::boolean = false) as unactivated,
        COUNT(*) FILTER (WHERE (metadata->>'displaced_activated')::boolean = true) as activated
      FROM serial_change_history
      WHERE change_type = 'ont_serial'
        AND metadata->>'displaced_serial' IS NOT NULL
    `);

    const summary = counts.rows[0];

    // CSV Export
    if (format === 'csv') {
      const escapeCSV = (val: unknown): string => {
        const str = String(val ?? '');
        return `"${str.replace(/"/g, '""')}"`;
      };
      const classifySerial = (serial: string): string => {
        const s = (serial || '').toUpperCase();
        if (/^ALCL|^HWTC/.test(s)) return 'ONT';
        if (s.startsWith('GU18')) return 'UPS';
        return 'Invalid';
      };

      const csvRows = [
        ['DR Number', 'Displaced Serial', 'Type', 'OES Status', 'Owner DR', 'Owner Team', 'Replaced With', 'Fixed On'].join(','),
        ...result.rows.map(r => [
          escapeCSV(r.drop_number),
          escapeCSV(r.displaced_serial),
          escapeCSV(classifySerial(r.displaced_serial)),
          escapeCSV(r.displaced_activated ? 'Activated' : 'Unactivated'),
          escapeCSV(r.displaced_owner_dr),
          escapeCSV(r.displaced_owner_team),
          escapeCSV(r.new_value),
          escapeCSV(r.created_at ? new Date(r.created_at).toISOString() : ''),
        ].join(','))
      ].join('\n');

      const filterLabel = filter === 'all' ? 'all' : filter;
      const filename = `olt-displaced-onts-${filterLabel}-${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      return res.send(csvRows);
    }

    return apiResponse.success(res, {
      total: parseInt(summary.total),
      unactivated: parseInt(summary.unactivated),
      activated: parseInt(summary.activated),
      records: result.rows,
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
