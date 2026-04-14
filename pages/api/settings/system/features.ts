/**
 * System Feature Settings API
 *
 * GET: Returns all system feature settings
 * PUT: Updates a single feature setting
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

interface FeatureSetting {
  id: string;
  feature_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
}

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
    const features = await sql`
      SELECT
        id,
        feature_key,
        enabled,
        config,
        updated_at,
        updated_by
      FROM system_feature_settings
      ORDER BY feature_key
    `;

    return apiResponse.success(res, features as unknown as FeatureSetting[]);
  } catch (error) {
    log.error('Failed to fetch system feature settings', { error });
    return apiResponse.databaseError(res, error, 'Failed to fetch feature settings');
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { feature_key, enabled, config } = req.body;

    if (!feature_key) {
      return apiResponse.badRequest(res, 'feature_key is required');
    }

    if (typeof enabled !== 'boolean') {
      return apiResponse.badRequest(res, 'enabled must be a boolean');
    }

    // Get user ID from request if available
    const userId = (req as AuthenticatedNextApiRequest).user?.id ?? null;

    // Upsert the feature setting
    const result = await sql`
      INSERT INTO system_feature_settings (feature_key, enabled, config, updated_at, updated_by)
      VALUES (
        ${feature_key},
        ${enabled},
        ${config ? JSON.stringify(config) : '{}'}::jsonb,
        NOW(),
        ${userId}
      )
      ON CONFLICT (feature_key) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        config = COALESCE(EXCLUDED.config, system_feature_settings.config),
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING id, feature_key, enabled, config, updated_at
    `;

    log.info('Feature setting updated', {
      feature_key,
      enabled,
      updated_by: userId,
    });

    return apiResponse.success(res, result[0]);
  } catch (error) {
    log.error('Failed to update system feature setting', { error });
    return apiResponse.databaseError(res, error, 'Failed to update feature setting');
  }
}

export default withAuth(handler);
