/**
 * Fibertime SharePoint — One-Time Device Code Auth
 *
 * Obtains an OAuth2 refresh token for reporting@velocityfibre.co.za via the
 * device code flow, then prints the refresh token for storage in .env.local.
 *
 * Prerequisites:
 *   - FIBERTIME_SP_CLIENT_ID must be set in .env.local
 *   - The user must sign in to Microsoft at the printed URL
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register -P tsconfig.json scripts/fibertime-device-auth.ts
 */

import 'dotenv/config';

// ============================================================================
// TYPES
// ============================================================================

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenSuccessResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface TokenPendingResponse {
  error: 'authorization_pending' | 'slow_down';
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

type TokenPollResponse = TokenSuccessResponse | TokenPendingResponse | TokenErrorResponse;

// ============================================================================
// HELPERS
// ============================================================================

const DEVICE_CODE_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPES =
  'https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/Sites.Read.All offline_access';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTokenSuccess(data: TokenPollResponse): data is TokenSuccessResponse {
  return 'refresh_token' in data;
}

function isTokenPending(data: TokenPollResponse): data is TokenPendingResponse {
  return (
    'error' in data &&
    (data.error === 'authorization_pending' || data.error === 'slow_down')
  );
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const clientId = process.env.FIBERTIME_SP_CLIENT_ID;
  if (!clientId) {
    process.stderr.write(
      'ERROR: FIBERTIME_SP_CLIENT_ID is not set in .env.local\n' +
        'Create an Azure AD public client app and set its client ID.\n'
    );
    process.exit(1);
  }

  // Step 1 — Request device code
  const deviceCodeParams = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
  });

  const deviceCodeRes = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: deviceCodeParams.toString(),
  });

  if (!deviceCodeRes.ok) {
    const errText = await deviceCodeRes.text();
    process.stderr.write(`ERROR: Device code request failed: ${deviceCodeRes.status} ${errText}\n`);
    process.exit(1);
  }

  const deviceCode = (await deviceCodeRes.json()) as DeviceCodeResponse;

  process.stdout.write('\n=== Fibertime SharePoint Auth ===\n\n');
  process.stdout.write(`1. Visit: ${deviceCode.verification_uri}\n`);
  process.stdout.write(`2. Enter code: ${deviceCode.user_code}\n`);
  process.stdout.write(`3. Sign in as reporting@velocityfibre.co.za\n\n`);
  process.stdout.write('Waiting for authentication...\n');

  // Step 2 — Poll for token
  const pollIntervalMs = (deviceCode.interval + 1) * 1000; // +1 to avoid throttle
  const expiresAt = Date.now() + deviceCode.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await sleep(pollIntervalMs);

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode.device_code,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const data = (await tokenRes.json()) as TokenPollResponse;

    if (isTokenSuccess(data)) {
      process.stdout.write('\n=== Authentication Successful ===\n\n');
      process.stdout.write('Add this to .env.local (and both deploy dirs):\n\n');
      process.stdout.write(`FIBERTIME_SP_REFRESH_TOKEN=${data.refresh_token}\n\n`);
      process.stdout.write(
        'NOTE: This refresh token is long-lived. Rotate it if you see\n' +
          '"Fibertime OAuth refresh failed: 400" errors in production logs.\n\n'
      );
      return;
    }

    if (isTokenPending(data)) {
      // Still waiting — keep polling
      if (data.error === 'slow_down') {
        // Back off by doubling the poll interval this round
        await sleep(pollIntervalMs);
      }
      process.stdout.write('.');
      continue;
    }

    // Any other error — abort
    const errData = data as TokenErrorResponse;
    if (errData.error === 'expired_token') {
      process.stderr.write('\nERROR: Device code expired. Please run the script again.\n');
      process.exit(1);
    }

    process.stderr.write(
      `\nERROR: Token poll failed: ${errData.error} — ${errData.error_description ?? ''}\n`
    );
    process.exit(1);
  }

  process.stderr.write('\nERROR: Device code expired before authentication completed.\n');
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`FATAL: ${msg}\n`);
  process.exit(1);
});
