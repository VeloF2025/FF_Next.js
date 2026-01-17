/**
 * Sage OAuth Callback Handler
 *
 * GET - Handle OAuth callback from Sage
 *
 * Receives authorization code and exchanges it for tokens.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { SageClient } from '@/services/sage';

const logger = createLogger({ module: 'api:sage:oauth:callback' });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors from Sage
  if (error) {
    logger.error('OAuth error from Sage', { error, error_description });
    return res.redirect(`/settings/integrations?error=${encodeURIComponent(String(error_description || error))}`);
  }

  if (!code || !state) {
    logger.error('Missing code or state in OAuth callback');
    return res.redirect('/settings/integrations?error=Missing authorization code');
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Get config and verify state
    const configResult = await sql`
      SELECT
        id,
        client_id,
        client_secret,
        company_id,
        base_url,
        redirect_uri,
        oauth_state,
        oauth_state_expires_at
      FROM sage_api_config
      WHERE is_active = true
      LIMIT 1
    `;

    if (configResult.length === 0) {
      logger.error('No Sage config found during OAuth callback');
      return res.redirect('/settings/integrations?error=Configuration not found');
    }

    const config = configResult[0];

    // Verify state token (CSRF protection)
    if (config.oauth_state !== state) {
      logger.error('OAuth state mismatch', {
        expected: config.oauth_state?.substring(0, 8) + '...',
        received: String(state).substring(0, 8) + '...',
      });
      return res.redirect('/settings/integrations?error=Invalid state token');
    }

    // Check if state has expired
    if (config.oauth_state_expires_at && new Date(config.oauth_state_expires_at) < new Date()) {
      logger.error('OAuth state has expired');
      return res.redirect('/settings/integrations?error=Authorization expired. Please try again.');
    }

    // Exchange code for tokens
    const client = new SageClient({
      clientId: config.client_id,
      clientSecret: config.client_secret,
      companyId: config.company_id,
      baseUrl: config.base_url,
    });

    const tokens = await client.exchangeCodeForTokens(String(code), config.redirect_uri);

    // Save tokens to database
    await sql`
      UPDATE sage_api_config
      SET
        access_token = ${tokens.accessToken},
        refresh_token = ${tokens.refreshToken},
        token_expires_at = ${tokens.expiresAt.toISOString()},
        is_connected = true,
        oauth_state = NULL,
        oauth_state_expires_at = NULL,
        last_token_refresh_at = NOW(),
        updated_at = NOW()
      WHERE id = ${config.id}
    `;

    // Log sync history
    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        status,
        records_processed,
        details
      ) VALUES (
        'oauth_connect',
        'inbound',
        'success',
        1,
        ${{ message: 'OAuth authorization completed successfully' }}
      )
    `;

    logger.info('Sage OAuth completed successfully', { configId: config.id });

    // Redirect to settings page with success message
    return res.redirect('/settings/integrations?sage=connected');
  } catch (error) {
    logger.error('OAuth callback failed', { error });

    // Log failure
    const sql2 = neon(process.env.DATABASE_URL!);
    try {
      await sql2`
        INSERT INTO sage_sync_history (
          operation_type,
          direction,
          status,
          error_message,
          details
        ) VALUES (
          'oauth_connect',
          'inbound',
          'failed',
          ${error instanceof Error ? error.message : 'Unknown error'},
          ${{ error: String(error) }}
        )
      `;
    } catch (logError) {
      logger.error('Failed to log OAuth error', { error: logError });
    }

    const errorMessage = error instanceof Error ? error.message : 'Authorization failed';
    return res.redirect(`/settings/integrations?error=${encodeURIComponent(errorMessage)}`);
  }
}
