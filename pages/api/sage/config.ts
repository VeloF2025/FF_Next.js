/**
 * Sage Configuration API
 *
 * GET  - Retrieve current Sage configuration (masked)
 * PUT  - Update Sage configuration
 *
 * Stores credentials in sage_api_config table.
 *
 * South African Sage API uses OAuth 2.0:
 * - client_id = OAuth Client ID
 * - client_secret = OAuth Client Secret
 * - OAuth tokens stored after authorization flow
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
  has_tokens: boolean;
  created_at: string;
  updated_at: string;
}

interface SageConfigInput {
  client_id: string;
  client_secret?: string;
  company_id: string;
  base_url?: string;
  api_version?: string;
  redirect_uri?: string;
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
          (access_token IS NOT NULL AND refresh_token IS NOT NULL) as has_tokens,
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
      if (!input.client_id) {
        return apiResponse.badRequest(res, 'Client ID is required');
      }

      // Check if config exists
      const existing = await sql`
        SELECT id FROM sage_api_config WHERE is_active = true LIMIT 1
      `;

      const defaultRedirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app'}/api/sage/oauth/callback`;

      if (existing.length > 0) {
        // Update existing config - preserve tokens if they exist
        const result = await sql`
          UPDATE sage_api_config
          SET
            client_id = ${input.client_id},
            client_secret = COALESCE(${input.client_secret || null}, client_secret),
            company_id = COALESCE(${input.company_id || null}, company_id),
            auth_type = 'oauth',
            base_url = ${input.base_url || 'https://accounting.sageone.co.za'},
            api_version = ${input.api_version || '2.0.0'},
            redirect_uri = ${input.redirect_uri || defaultRedirectUri},
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
            (access_token IS NOT NULL AND refresh_token IS NOT NULL) as has_tokens,
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
            client_id,
            client_secret,
            company_id,
            auth_type,
            base_url,
            api_version,
            redirect_uri,
            sync_enabled,
            sync_interval_minutes
          ) VALUES (
            ${input.client_id},
            ${input.client_secret || null},
            ${input.company_id || null},
            'oauth',
            ${input.base_url || 'https://accounting.sageone.co.za'},
            ${input.api_version || '2.0.0'},
            ${input.redirect_uri || defaultRedirectUri},
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
            (access_token IS NOT NULL AND refresh_token IS NOT NULL) as has_tokens,
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
