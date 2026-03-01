/**
 * Procurement Default Terms Settings API
 *
 * GET: Returns all procurement settings (terms + general)
 * PUT: Updates setting values
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(res);
  }

  if (req.method === 'PUT') {
    return handlePut(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}

async function handleGet(res: NextApiResponse) {
  try {
    const settings = await sql`
      SELECT id, setting_key, setting_value, category, label, description
      FROM procurement_settings
      ORDER BY category, setting_key
    `;

    const result = settings.map((s: Record<string, unknown>) => ({
      id: s.id,
      key: s.setting_key,
      value: s.setting_value,
      category: s.category,
      label: s.label,
      description: s.description,
    }));

    return apiResponse.success(res, { settings: result });
  } catch (error) {
    log.error('Failed to fetch procurement settings', { error });
    return apiResponse.databaseError(res, error, 'Failed to fetch settings');
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { settings } = req.body;

    if (!settings || !Array.isArray(settings)) {
      return apiResponse.badRequest(res, 'settings array is required');
    }

    for (const setting of settings) {
      if (!setting.key) continue;

      await sql`
        UPDATE procurement_settings
        SET
          setting_value = ${JSON.stringify(setting.value)},
          updated_at = NOW()
        WHERE setting_key = ${setting.key}
      `;
    }

    log.info('Procurement settings updated', { count: settings.length });
    return apiResponse.success(res, { message: 'Settings updated successfully' });
  } catch (error) {
    log.error('Failed to update procurement settings', { error });
    return apiResponse.databaseError(res, error, 'Failed to update settings');
  }
}

export default withAuth(handler);
