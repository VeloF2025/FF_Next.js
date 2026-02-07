/**
 * WhatsApp Templates API
 * GET /api/communications/whatsapp/templates - List all templates
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type { WaMessageTemplate, WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaMessageTemplate[]>>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { category, enabled } = req.query;

    let query = `
      SELECT
        id, template_key, template_name, template_content, variables,
        category, enabled, is_default, created_at, updated_at
      FROM wa_message_templates
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (category) {
      query += ` AND category = $${paramIndex++}`;
      params.push(category);
    }

    if (enabled === 'true') {
      query += ' AND enabled = true';
    } else if (enabled === 'false') {
      query += ' AND enabled = false';
    }

    query += ' ORDER BY category, template_name ASC';

    const result = await pool.query(query, params);

    // Parse variables JSON for each template
    const parsedTemplates = result.rows.map((t: Record<string, unknown>) => ({
      ...t,
      variables: Array.isArray(t.variables) ? t.variables : JSON.parse(t.variables as string || '[]'),
    })) as WaMessageTemplate[];

    return res.status(200).json({
      success: true,
      data: parsedTemplates,
    });

  } catch (error) {
    log.error('[WA Templates API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
