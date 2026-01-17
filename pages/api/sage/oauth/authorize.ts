/**
 * Sage OAuth Authorization Initiation
 *
 * GET - Redirect to Sage OAuth authorization page
 *
 * Starts the OAuth flow by redirecting the user to Sage for consent.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { SageClient } from '@/services/sage';
import { randomBytes } from 'crypto';

const logger = createLogger({ module: 'api:sage:oauth:authorize' });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, ['GET']);
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
        redirect_uri
      FROM sage_api_config
      WHERE is_active = true
      LIMIT 1
    `;

    if (configResult.length === 0) {
      return apiResponse.badRequest(res, 'Sage is not configured. Please add credentials first.');
    }

    const config = configResult[0];

    // Generate state token for CSRF protection
    const state = randomBytes(32).toString('hex');

    // Store state in database for verification
    await sql`
      UPDATE sage_api_config
      SET
        oauth_state = ${state},
        oauth_state_expires_at = NOW() + INTERVAL '10 minutes',
        updated_at = NOW()
      WHERE id = ${config.id}
    `;

    // Create client and get authorization URL
    const client = new SageClient({
      clientId: config.client_id,
      clientSecret: config.client_secret,
      companyId: config.company_id,
      baseUrl: config.base_url,
    });

    const authUrl = client.getAuthorizationUrl(config.redirect_uri, state);

    logger.info('Redirecting to Sage OAuth', { state: state.substring(0, 8) + '...' });

    // Redirect to Sage authorization page
    res.redirect(302, authUrl);
  } catch (error) {
    logger.error('OAuth authorization initiation failed', { error });
    return apiResponse.internalError(res, error);
  }
}
