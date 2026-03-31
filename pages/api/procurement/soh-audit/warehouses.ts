/**
 * GET  /api/procurement/soh-audit/warehouses — list active warehouses
 * POST /api/procurement/soh-audit/warehouses — add new warehouse
 */
import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

export interface SOHWarehouse {
  id: string;
  name: string;
  type: 'warehouse' | 'project' | 'dc';
  is_active: boolean;
  sort_order: number;
}

export default withAuth(async (req: AuthenticatedNextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id::text, name, type, is_active, sort_order
        FROM soh_audit_warehouses
        WHERE is_active = true
        ORDER BY sort_order ASC, name ASC
      `;
      return apiResponse.success(res, rows as SOHWarehouse[]);
    } catch (err) {
      log.error('Failed to fetch SOH warehouses', { error: (err as Error).message }, 'SOHAuditWarehouses');
      return apiResponse.internalError(res, 'Failed to fetch warehouses');
    }
  }

  if (req.method === 'POST') {
    const { name, type } = req.body as { name?: string; type?: string };
    if (!name?.trim()) return apiResponse.badRequest(res, 'name is required');
    const warehouseType = type ?? 'warehouse';

    try {
      const maxOrder = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM soh_audit_warehouses`;
      const next = (maxOrder[0] as { next: number }).next;
      const rows = await sql`
        INSERT INTO soh_audit_warehouses (name, type, sort_order)
        VALUES (${name.trim()}, ${warehouseType}, ${next})
        ON CONFLICT (name) DO NOTHING
        RETURNING id::text, name, type, is_active, sort_order
      `;
      if (rows.length === 0) return apiResponse.badRequest(res, 'Warehouse name already exists');
      return apiResponse.created(res, rows[0]);
    } catch (err) {
      log.error('Failed to add SOH warehouse', { error: (err as Error).message }, 'SOHAuditWarehouses');
      return apiResponse.internalError(res, 'Failed to add warehouse');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
});
