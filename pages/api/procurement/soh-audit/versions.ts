/**
 * GET  /api/procurement/soh-audit/versions        — list all versions
 * GET  /api/procurement/soh-audit/versions?id=X   — fetch version + entries
 * POST /api/procurement/soh-audit/versions        — create version + entries
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

export interface SOHAuditEntry {
  id: string;
  item_code: string | null;
  item_name: string;
  category: string;
  uom: string;
  boq_rate: number;
  quantities: Record<string, number>;
  notes: string | null;
}

export interface SOHAuditVersion {
  id: string;
  version_label: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  entry_count?: number;
  entries?: SOHAuditEntry[];
}

export default withAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method === 'GET') {
    const { id } = req.query;

    if (id && typeof id === 'string') {
      // Fetch single version with entries
      try {
        const versions = await sql`
          SELECT id::text, version_label, notes, created_by, created_at
          FROM soh_audit_versions WHERE id = ${id}::uuid
        `;
        if (versions.length === 0) return apiResponse.notFound(res, 'Version not found');

        const entries = await sql`
          SELECT id::text, item_code, item_name, category, uom,
                 boq_rate::float AS boq_rate, quantities, notes
          FROM soh_audit_entries
          WHERE version_id = ${id}::uuid
          ORDER BY category ASC, item_name ASC
        `;
        return apiResponse.success(res, { ...versions[0], entries });
      } catch (err) {
        log.error('Failed to fetch SOH version', { error: (err as Error).message }, 'SOHAuditVersions');
        return apiResponse.internalError(res, 'Failed to fetch version');
      }
    }

    // List all versions
    try {
      const rows = await sql`
        SELECT v.id::text, v.version_label, v.notes, v.created_by, v.created_at,
               COUNT(e.id)::int AS entry_count
        FROM soh_audit_versions v
        LEFT JOIN soh_audit_entries e ON e.version_id = v.id
        GROUP BY v.id, v.version_label, v.notes, v.created_by, v.created_at
        ORDER BY v.created_at DESC
      `;
      return apiResponse.success(res, rows as SOHAuditVersion[]);
    } catch (err) {
      log.error('Failed to list SOH versions', { error: (err as Error).message }, 'SOHAuditVersions');
      return apiResponse.internalError(res, 'Failed to list versions');
    }
  }

  if (req.method === 'POST') {
    const { version_label, notes, entries } = req.body as {
      version_label?: string;
      notes?: string;
      entries?: Array<{
        item_code?: string;
        item_name: string;
        category?: string;
        uom?: string;
        boq_rate?: number;
        quantities: Record<string, number>;
        notes?: string;
      }>;
    };

    if (!version_label?.trim()) return apiResponse.badRequest(res, 'version_label is required');
    if (!Array.isArray(entries) || entries.length === 0) return apiResponse.badRequest(res, 'entries array is required');

    try {
      const versionRows = await sql`
        INSERT INTO soh_audit_versions (version_label, notes, created_by)
        VALUES (${version_label.trim()}, ${notes ?? null}, ${(req as AuthenticatedNextApiRequest & { user?: { email?: string } }).user?.email ?? 'system'})
        RETURNING id::text, version_label, created_at
      `;
      const versionId = (versionRows[0] as { id: string }).id;

      for (const entry of entries) {
        await sql`
          INSERT INTO soh_audit_entries
            (version_id, item_code, item_name, category, uom, boq_rate, quantities, notes)
          VALUES (
            ${versionId}::uuid,
            ${entry.item_code ?? null},
            ${entry.item_name},
            ${entry.category ?? 'Uncategorized'},
            ${entry.uom ?? 'units'},
            ${entry.boq_rate ?? 0},
            ${JSON.stringify(entry.quantities)},
            ${entry.notes ?? null}
          )
        `;
      }

      return apiResponse.created(res, { version_id: versionId, rows_imported: entries.length });
    } catch (err) {
      log.error('Failed to create SOH version', { error: (err as Error).message }, 'SOHAuditVersions');
      return apiResponse.internalError(res, 'Failed to create version');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
});
