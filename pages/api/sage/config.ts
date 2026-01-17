/**
 * Sage Configuration API
 *
 * GET  - Retrieve current Sage configuration (masked)
 * PUT  - Update Sage configuration
 *
 * Stores credentials in sage_api_config table.
 *
 * South African Sage API uses Basic Auth + API Key:
 * - client_id = API Key (query param: ?apikey=xxx)
 * - username = Sage account email
 * - password = Sage account password
 * - Auth header: Basic base64(username:password)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger({ module: 'api:sage:config' });

interface SageConfig {
  id: string;
  client_id: string;
  client_secret_masked: string;
  company_id: string;
  base_url: string;
  api_version: string;
  redirect_uri: string;
  is_connected: boolean;
  last_connection_test_at: string | null;
  last_sync_at: string | null;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  auth_type: 'oauth' | 'basic';
  username: string | null;
  password_masked: string | null;
  created_at: string;
  updated_at: string;
}

interface SageConfigInput {
  client_id: string;
  client_secret?: string;
  company_id: string;
  username?: string;
  password?: string;
  base_url?: string;
  api_version?: string;
  redirect_uri?: string;
  auth_type?: 'oauth' | 'basic';
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
          client_id,
          CASE WHEN client_secret IS NOT NULL AND LENGTH(client_secret) > 8
            THEN CONCAT(LEFT(client_secret, 4), '****', RIGHT(client_secret, 4))
            ELSE NULL
          END as client_secret_masked,
          company_id,
          base_url,
          api_version,
          redirect_uri,
          is_connected,
          last_connection_test_at,
          last_sync_at,
          sync_enabled,
          sync_interval_minutes,
          auth_type,
          username,
          CASE WHEN password IS NOT NULL AND LENGTH(password) > 4
            THEN CONCAT(LEFT(password, 2), '****', RIGHT(password, 2))
            ELSE NULL
          END as password_masked,
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
      const authType = input.auth_type || 'basic';

      // Validate required fields based on auth type
      if (!input.client_id || !input.company_id) {
        return apiResponse.badRequest(res, 'client_id (API key) and company_id are required');
      }

      // For Basic Auth, username and password are required
      if (authType === 'basic' && (!input.username || !input.password)) {
        // Check if we have existing credentials and not updating them
        const existingConfig = await sql`
          SELECT username, password FROM sage_api_config WHERE is_active = true LIMIT 1
        `;
        if (existingConfig.length === 0 || (!existingConfig[0].username && !input.username)) {
          return apiResponse.badRequest(res, 'username and password are required for Basic Auth');
        }
      }

      // Check if config exists
      const existing = await sql`
        SELECT id FROM sage_api_config WHERE is_active = true LIMIT 1
      `;

      if (existing.length > 0) {
        // Update existing config - only update password/username if provided
        const result = await sql`
          UPDATE sage_api_config
          SET
            client_id = ${input.client_id},
            client_secret = COALESCE(${input.client_secret || null}, client_secret),
            company_id = ${input.company_id},
            username = COALESCE(${input.username || null}, username),
            password = COALESCE(${input.password || null}, password),
            auth_type = ${authType},
            base_url = ${input.base_url || 'https://accounting.sageone.co.za'},
            api_version = ${input.api_version || '2.0.0'},
            redirect_uri = ${input.redirect_uri || `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app'}/api/sage/oauth/callback`},
            sync_enabled = ${input.sync_enabled ?? true},
            sync_interval_minutes = ${input.sync_interval_minutes ?? 15},
            updated_at = NOW()
          WHERE id = ${existing[0].id}
          RETURNING
            id,
            client_id,
            CASE WHEN client_secret IS NOT NULL AND LENGTH(client_secret) > 8
              THEN CONCAT(LEFT(client_secret, 4), '****', RIGHT(client_secret, 4))
              ELSE NULL
            END as client_secret_masked,
            company_id,
            base_url,
            api_version,
            redirect_uri,
            is_connected,
            last_connection_test_at,
            last_sync_at,
            sync_enabled,
            sync_interval_minutes,
            auth_type,
            username,
            CASE WHEN password IS NOT NULL AND LENGTH(password) > 4
              THEN CONCAT(LEFT(password, 2), '****', RIGHT(password, 2))
              ELSE NULL
            END as password_masked,
            created_at,
            updated_at
        `;

        logger.info('Sage config updated', { configId: existing[0].id, authType });

        return apiResponse.success(res, {
          message: 'Configuration updated',
          config: result[0] as SageConfig,
        });
      } else {
        // Create new config
        const result = await sql`
          INSERT INTO sage_api_config (
            client_id,
            client_secret,
            company_id,
            username,
            password,
            auth_type,
            base_url,
            api_version,
            redirect_uri,
            sync_enabled,
            sync_interval_minutes
          ) VALUES (
            ${input.client_id},
            ${input.client_secret || null},
            ${input.company_id},
            ${input.username || null},
            ${input.password || null},
            ${authType},
            ${input.base_url || 'https://accounting.sageone.co.za'},
            ${input.api_version || '2.0.0'},
            ${input.redirect_uri || `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app'}/api/sage/oauth/callback`},
            ${input.sync_enabled ?? true},
            ${input.sync_interval_minutes ?? 15}
          )
          RETURNING
            id,
            client_id,
            CASE WHEN client_secret IS NOT NULL AND LENGTH(client_secret) > 8
              THEN CONCAT(LEFT(client_secret, 4), '****', RIGHT(client_secret, 4))
              ELSE NULL
            END as client_secret_masked,
            company_id,
            base_url,
            api_version,
            redirect_uri,
            is_connected,
            last_connection_test_at,
            last_sync_at,
            sync_enabled,
            sync_interval_minutes,
            auth_type,
            username,
            CASE WHEN password IS NOT NULL AND LENGTH(password) > 4
              THEN CONCAT(LEFT(password, 2), '****', RIGHT(password, 2))
              ELSE NULL
            END as password_masked,
            created_at,
            updated_at
        `;

        logger.info('Sage config created', { configId: result[0].id, authType });

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
