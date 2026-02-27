/**
 * Customer Categories API
 * GET: List categories with client count
 * POST: Create category
 * PUT: Update category
 * DELETE: Remove category
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import sql from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

export default withAuth(async function handler(req: NextApiRequest, res: NextApiResponse) {

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT cc.id, cc.name, cc.description, cc.created_at,
               COUNT(c.id)::int AS client_count
        FROM customer_categories cc
        LEFT JOIN clients c ON LOWER(c.category) = LOWER(cc.name)
        GROUP BY cc.id
        ORDER BY cc.name
      `;
      return apiResponse.success(res, rows.map(r => ({
        id: r.id, name: r.name, description: r.description || '',
        clientCount: Number(r.client_count) || 0,
      })));
    }

    if (req.method === 'POST') {
      const { name, description } = req.body;
      if (!name?.trim()) return apiResponse.badRequest(res, 'Name is required');
      const [row] = await sql`
        INSERT INTO customer_categories (name, description)
        VALUES (${name.trim()}, ${description || ''})
        RETURNING id, name, description
      `;
      return apiResponse.success(res, row);
    }

    if (req.method === 'PUT') {
      const { id, name, description } = req.body;
      if (!id || !name?.trim()) return apiResponse.badRequest(res, 'ID and name are required');
      await sql`
        UPDATE customer_categories
        SET name = ${name.trim()}, description = ${description || ''}
        WHERE id = ${id}
      `;
      return apiResponse.success(res, { id, name, description });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return apiResponse.badRequest(res, 'ID is required');
      await sql`DELETE FROM customer_categories WHERE id = ${id}`;
      return apiResponse.success(res, { deleted: true });
    }

    return apiResponse.methodNotAllowed(res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('does not exist')) {
      return apiResponse.success(res, []);
    }
    log.error('customer-categories API error', { error: message });
    return apiResponse.error(res, 'Failed to process request');
  }
});
