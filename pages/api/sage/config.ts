/**
 * Sage Configuration API
 *
 * GET  - Retrieve current Sage configuration (masked)
 * PUT  - Update Sage configuration
 *
 * Stores credentials in sage_api_config table.
 *
 * South African Sage API v2.0.0 uses Basic Auth:
 * - api_key = API Key from Sage Developer Portal
 * - username = Sage account email
 * - password = Sage account password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger({ module: 'api:sage:config' });

interface SageConfig {
  id: string;
  api_key_masked: string;
  username: string;
  password_masked: string;
  company_id: string;
  base_url: string;
  api_version: string;
  is_connected: boolean;
  last_connection_test_at: string | null;
  last_sync_at: string | null;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  auth_type: string;
  created_at: string;
  updated_at: string;
}

interface SageConfigInput {
  api_key?: string;
  username: string;
  password?: string;
  company_id?: string;
  base_url?: string;
  api_version?: string;
  sync_enabled?: boolean;
  sync_interval_minutes?: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    if (req.method === 'GET') {
      // Get current configuration (masked secrets)
      const result = await sql`
        SELECT
          id,
          CASE WHEN api_key IS NOT NULL AND LENGTH(api_key) > 8
            THEN CONCAT(LEFT(api_key, 4), '****', RIGHT(api_key, 4))
            ELSE NULL
          END as api_key_masked,
          username,
          CASE WHEN password IS NOT NULL AND LENGTH(password) > 4
            THEN CONCAT(LEFT(password, 2), '****')
            ELSE NULL
          END as password_masked,
          company_id,
          base_url,
          api_version,
          is_connected,
          last_connection_test_at,
          last_sync_at,
          sync_enabled,
          sync_interval_minutes,
          auth_type,
          created_at,
          updated_at
        FROM sage_api_config
        WHERE is_active = true
        LIMIT 1
      `;

      if (result.length === 0) {
        return apiResponse.success(res, {
          configured: false,
          config: null,
        });
      }

      return apiResponse.success(res, {
        configured: true,
        config: result[0] as SageConfig,
      });
    }

    if (req.method === 'PUT') {
      const input = req.body as SageConfigInput;

      // Validate required fields
      if (!input.username) {
        return apiResponse.badRequest(res, 'Username is required');
      }

      // Check if config exists
      const existing = await sql`
        SELECT id FROM sage_api_config WHERE is_active = true LIMIT 1
      `;

      if (existing.length > 0) {
        // Update existing config
        const result = await sql`
          UPDATE sage_api_config
          SET
            api_key = COALESCE(${input.api_key || null}, api_key),
            username = ${input.username},
            password = COALESCE(${input.password || null}, password),
            company_id = COALESCE(${input.company_id || null}, company_id),
            auth_type = 'basic',
            base_url = ${input.base_url || 'https://accounting.sageone.co.za'},
            api_version = ${input.api_version || '2.0.0'},
            sync_enabled = ${input.sync_enabled ?? true},
            sync_interval_minutes = ${input.sync_interval_minutes ?? 15},
            updated_at = NOW()
          WHERE id = ${existing[0].id}
          RETURNING
            id,
            CASE WHEN api_key IS NOT NULL AND LENGTH(api_key) > 8
              THEN CONCAT(LEFT(api_key, 4), '****', RIGHT(api_key, 4))
              ELSE NULL
            END as api_key_masked,
            username,
            CASE WHEN password IS NOT NULL AND LENGTH(password) > 4
              THEN CONCAT(LEFT(password, 2), '****')
              ELSE NULL
            END as password_masked,
            company_id,
            base_url,
            api_version,
            is_connected,
            last_connection_test_at,
            last_sync_at,
            sync_enabled,
            sync_interval_minutes,
            auth_type,
            created_at,
            updated_at
        `;

        logger.info('Sage config updated', { configId: existing[0].id });

        return apiResponse.success(res, {
          message: 'Configuration updated',
          config: result[0] as SageConfig,
        });
      } else {
        // Create new config
        const result = await sql`
          INSERT INTO sage_api_config (
            api_key,
            username,
            password,
            company_id,
            auth_type,
            base_url,
            api_version,
            sync_enabled,
            sync_interval_minutes
          ) VALUES (
            ${input.api_key || null},
            ${input.username},
            ${input.password || null},
            ${input.company_id || null},
            'basic',
            ${input.base_url || 'https://accounting.sageone.co.za'},
            ${input.api_version || '2.0.0'},
            ${input.sync_enabled ?? true},
            ${input.sync_interval_minutes ?? 15}
          )
          RETURNING
            id,
            CASE WHEN api_key IS NOT NULL AND LENGTH(api_key) > 8
              THEN CONCAT(LEFT(api_key, 4), '****', RIGHT(api_key, 4))
              ELSE NULL
            END as api_key_masked,
            username,
            CASE WHEN password IS NOT NULL AND LENGTH(password) > 4
              THEN CONCAT(LEFT(password, 2), '****')
              ELSE NULL
            END as password_masked,
            company_id,
            base_url,
            api_version,
            is_connected,
            last_connection_test_at,
            last_sync_at,
            sync_enabled,
            sync_interval_minutes,
            auth_type,
            created_at,
            updated_at
        `;

        logger.info('Sage config created', { configId: result[0].id });

        return apiResponse.created(res, {
          message: 'Configuration created',
          config: result[0] as SageConfig,
        });
      }
    }

    return apiResponse.methodNotAllowed(res, ['GET', 'PUT']);
  } catch (error) {
    logger.error('Sage config error', { error });
    return apiResponse.internalError(res, error);
  }
}
