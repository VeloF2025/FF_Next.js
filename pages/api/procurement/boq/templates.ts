import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

/**
 * BOQ Column Mapping Templates API
 * Manages reusable column mapping configurations for BOQ imports
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    try {
      const templates = await sql`
        SELECT
          id, name, supplier_name, headers, column_mapping,
          sheet_name, header_row, skip_rows, usage_count,
          last_used_at, created_by, created_at, updated_at
        FROM boq_column_templates
        ORDER BY usage_count DESC, updated_at DESC
      `;

      return apiResponse.success(res, templates);
    } catch (error) {
      log.error('Failed to fetch BOQ column templates', { data: { error: String(error) } }, 'boq-import');
      return apiResponse.internalError(res, error, 'Failed to fetch templates');
    }
  }

  if (req.method === 'POST') {
    try {
      const { name, supplierName, headers, columnMapping, sheetName, headerRow } = req.body;

      if (!name || !headers || !columnMapping) {
        return apiResponse.badRequest(res, 'Missing required fields: name, headers, columnMapping');
      }

      if (!Array.isArray(headers)) {
        return apiResponse.badRequest(res, 'headers must be an array');
      }

      const result = await sql`
        INSERT INTO boq_column_templates (
          name, supplier_name, headers, column_mapping,
          sheet_name, header_row, created_by
        )
        VALUES (
          ${name},
          ${supplierName || null},
          ${headers},
          ${JSON.stringify(columnMapping)},
          ${sheetName || null},
          ${headerRow || 0},
          ${'system'}
        )
        RETURNING *
      `;

      const template = result[0];
      log.info('BOQ column template created', { data: { templateId: template?.id, name } }, 'boq-import');

      return apiResponse.created(res, template, 'Template created successfully');
    } catch (error) {
      log.error('Failed to create BOQ column template', { data: { error: String(error) } }, 'boq-import');
      return apiResponse.internalError(res, error, 'Failed to create template');
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;

      if (!id || typeof id !== 'string') {
        return apiResponse.badRequest(res, 'Template ID is required');
      }

      const result = await sql`
        DELETE FROM boq_column_templates
        WHERE id = ${id}
        RETURNING id, name
      `;

      if (result.length === 0) {
        return apiResponse.notFound(res, 'Template', id);
      }

      log.info('BOQ column template deleted', { data: { templateId: id } }, 'boq-import');
      return apiResponse.success(res, { id, name: result[0]?.name });
    } catch (error) {
      log.error('Failed to delete BOQ column template', { data: { error: String(error) } }, 'boq-import');
      return apiResponse.internalError(res, error, 'Failed to delete template');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'DELETE']);
}

export default withAuth(handler);
