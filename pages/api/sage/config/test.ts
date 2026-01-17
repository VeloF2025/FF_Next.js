/**
 * Sage Connection Test API
 *
 * POST - Test connection to Sage API with stored credentials
 *
 * South African Sage API v2.0.0 uses Basic Auth:
 * - API Key + Username + Password
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
        api_key,
        username,
        password,
        company_id,
        base_url,
        api_version
      FROM sage_api_config
      WHERE is_active = true
      LIMIT 1
    `;

    if (configResult.length === 0) {
      return apiResponse.badRequest(res, 'Sage is not configured. Please add credentials first.');
    }

    const config = configResult[0];

    // Check required credentials
    if (!config.api_key) {
      return apiResponse.badRequest(res, 'API Key is required. Please update your Sage configuration.');
    }

    if (!config.username || !config.password) {
      return apiResponse.badRequest(res, 'Username and password are required. Please update your Sage configuration.');
    }

    // Create client with Basic Auth
    const client = createSageClientFromConfig({
      apiKey: config.api_key,
      username: config.username,
      password: config.password,
      companyId: config.company_id,
      baseUrl: config.base_url,
      apiVersion: config.api_version,
    });

    // Test connection
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

    logger.info('Sage connection test completed', { success: testResult.success });

    return apiResponse.success(res, {
      success: testResult.success,
      message: testResult.message,
      companyName: testResult.companyName,
      authType: 'basic',
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
