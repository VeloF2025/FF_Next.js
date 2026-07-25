/**
 * WhatsApp Cloud test send
 * POST /api/communications/whatsapp/test-send
 *
 * Sends ONE message on the Cloud channel to an operator-typed number, using
 * whatever credentials are currently configured. Used to prove the Meta setup
 * works before `wa_provider` is flipped.
 *
 * Deliberately pins `channel: 'cloud'` rather than resolving the configured
 * provider: this is a pre-flight check for Cloud specifically, and it must
 * never read or move the live provider.
 *
 * HTTP status describes the API call; `data.ok` describes the WhatsApp send.
 * A rejected send is a 200 carrying `ok: false` plus the provider's own error,
 * so the operator sees what actually went wrong instead of an opaque 500.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import rateLimiter from '@/lib/rateLimiter';
import { getWaReadiness } from '@/modules/communications/whatsapp/config/waGoLive';
import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { normalizeMsisdn } from '@/modules/communications/whatsapp/utils/phone';
import type { WaAdminApiResponse, WaTestSendResult } from '@/modules/communications/whatsapp/types/wa-admin.types';

const DEFAULT_MESSAGE = 'FibreFlow WhatsApp Cloud test message. No action needed.';
const MAX_MESSAGE_LENGTH = 1000;

/**
 * Per-operator cap. Without it this endpoint is a send oracle — a compromised
 * manager account could blast arbitrary text at arbitrary numbers from the
 * company's WhatsApp Business number. Verifying a setup needs a handful of
 * sends, not a stream.
 */
const TEST_SEND_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaTestSendResult>>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { toPhone, message } = (req.body ?? {}) as { toPhone?: string; message?: string };

  const normalized = normalizeMsisdn(toPhone);
  if (!normalized) {
    return res.status(400).json({
      success: false,
      error: 'A valid recipient number is required (e.g. 0821234567 or 27821234567)',
    });
  }

  const text = (typeof message === 'string' && message.trim() ? message : DEFAULT_MESSAGE)
    .slice(0, MAX_MESSAGE_LENGTH);

  const actor = (req as AuthenticatedNextApiRequest).user?.email ?? 'unknown';
  const rl = rateLimiter.check(`wa-test-send:${actor}`, TEST_SEND_LIMIT.limit, TEST_SEND_LIMIT.windowMs);
  if (!rl.success) {
    log.warn('[WA Test Send] Rate limit exhausted', { actor, resetAt: rl.resetAt });
    return res.status(429).json({
      success: false,
      error: 'Too many test sends. Wait a few minutes before trying again.',
    });
  }

  try {
    // Checked up front so incomplete credentials read as "not configured"
    // rather than as a generic send failure from deep inside the sender.
    const readiness = await getWaReadiness();
    if (!readiness.cloudConfigured) {
      return res.status(200).json({
        success: true,
        data: {
          ok: false,
          channel: 'cloud',
          notConfigured: true,
          error: 'WhatsApp Cloud credentials are not fully configured — see the readiness panel above.',
        },
      });
    }

    const result = await sendWhatsAppText({ toPhone: normalized, message: text, channel: 'cloud' });

    log.info('[WA Test Send] Cloud test send attempted', {
      ok: result.ok,
      outcome: result.outcome,
      error: result.error,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    log.error('[WA Test Send API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
