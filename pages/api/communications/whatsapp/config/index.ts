/**
 * WhatsApp Config API
 * GET /api/communications/whatsapp/config - List all configuration values
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type { WaServiceConfig, WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaServiceConfig[]>>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { category } = req.query;

    let query = `
      SELECT
        id, config_key, config_value, config_type, category,
        description, is_sensitive, updated_at, updated_by
      FROM wa_service_config
    `;

    const params: string[] = [];

    if (category && typeof category === 'string') {
      query += ' WHERE category = $1';
      params.push(category);
    }

    query += ' ORDER BY category, config_key ASC';

    const result = await pool.query(query, params);
    const configs = result.rows as WaServiceConfig[];

    // Mask sensitive values
    const maskedConfigs = configs.map(config => ({
      ...config,
      config_value: config.is_sensitive ? '********' : config.config_value,
    }));

    return res.status(200).json({
      success: true,
      data: maskedConfigs,
    });

  } catch (error) {
    console.error('[WA Config API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}
