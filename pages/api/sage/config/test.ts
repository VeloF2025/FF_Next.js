/**
 * Sage Connection Test API
 *
 * POST - Test connection to Sage API with stored credentials
 *
 * Tests OAuth authentication and API access.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { createSageClientFromConfig } from '@/services/sage';

const logger = createLogger({ module: 'api:sage:config:test' });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, ['POST']);
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Get active config
    const configResult = await sql`
      SELECT
        id,
        client_id,
        client_secret,
        company_id,
        base_url,
        api_version,
        access_token,
        refresh_token,
        token_expires_at
      FROM sage_api_config
      WHERE is_active = true
      LIMIT 1
    `;

    if (configResult.length === 0) {
      return apiResponse.badRequest(res, 'Sage is not configured. Please add credentials first.');
    }

    const config = configResult[0];

    // Check if we have OAuth tokens
    if (!config.access_token || !config.refresh_token) {
      return apiResponse.success(res, {
        success: false,
        message: 'OAuth not completed. Please authorize with Sage first.',
        needsAuthorization: true,
        authorizationUrl: `/api/sage/oauth/authorize`,
      });
    }

    // Create client and test connection
    const client = createSageClientFromConfig({
      clientId: config.client_id,
      clientSecret: config.client_secret,
      companyId: config.company_id,
      baseUrl: config.base_url,
      accessToken: config.access_token,
      refreshToken: config.refresh_token,
      expiresAt: config.token_expires_at ? new Date(config.token_expires_at) : undefined,
    });

    const testResult = await client.testConnection();

    // Update connection status in database
    await sql`
      UPDATE sage_api_config
      SET
        is_connected = ${testResult.success},
        last_connection_test_at = NOW(),
        last_connection_error = ${testResult.success ? null : testResult.message},
        updated_at = NOW()
      WHERE id = ${config.id}
    `;

    // If token was refreshed, save new tokens
    const tokens = client.getTokens();
    if (tokens && tokens.accessToken !== config.access_token) {
      await sql`
        UPDATE sage_api_config
        SET
          access_token = ${tokens.accessToken},
          refresh_token = ${tokens.refreshToken},
          token_expires_at = ${tokens.expiresAt.toISOString()},
          updated_at = NOW()
        WHERE id = ${config.id}
      `;
      logger.info('Sage tokens refreshed and saved');
    }

    logger.info('Sage connection test completed', { success: testResult.success });

    return apiResponse.success(res, {
      success: testResult.success,
      message: testResult.message,
      companyId: testResult.companyId,
      testedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Sage connection test failed', { error });

    // Update error status in database
    try {
      await sql`
        UPDATE sage_api_config
        SET
          is_connected = false,
          last_connection_test_at = NOW(),
          last_connection_error = ${error instanceof Error ? error.message : 'Unknown error'},
          updated_at = NOW()
        WHERE is_active = true
      `;
    } catch (dbError) {
      logger.error('Failed to update connection status', { error: dbError });
    }

    return apiResponse.success(res, {
      success: false,
      message: error instanceof Error ? error.message : 'Connection test failed',
      testedAt: new Date().toISOString(),
    });
  }
}
