/**
 * WhatsApp 1:1 provider flip
 * PUT /api/communications/whatsapp/provider  { provider, confirm }
 *
 * Moves every 1:1 WhatsApp send in the product between the legacy bridge and
 * the Meta Cloud API. Group sends are unaffected — Cloud cannot do groups.
 *
 * Guards, in order:
 *  - super_admin only;
 *  - `confirm: true` must be present, so a stray or replayed request cannot
 *    move the provider on its own (the UI asks first, the server insists);
 *  - switching TO cloud requires complete credentials, because flipping onto a
 *    half-configured provider takes 1:1 sending down. Switching BACK to bridge
 *    is the rollback path and is never blocked.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { getWaReadiness } from '@/modules/communications/whatsapp/config/waGoLive';
import type { WaProviderFlipResult, WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';

const PROVIDERS = ['bridge', 'cloud'] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaProviderFlipResult>>
) {
  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PUT']);
  }

  const { provider, confirm } = (req.body ?? {}) as { provider?: unknown; confirm?: unknown };

  if (!isProvider(provider)) {
    return res.status(400).json({
      success: false,
      error: `provider must be one of: ${PROVIDERS.join(', ')}`,
    });
  }

  if (confirm !== true) {
    return res.status(400).json({
      success: false,
      error: 'This change requires an explicit confirmation (confirm: true)',
    });
  }

  const actor = (req as AuthenticatedNextApiRequest).user?.email ?? null;

  try {
    if (provider === 'cloud') {
      const readiness = await getWaReadiness();
      if (!readiness.cloudConfigured) {
        return res.status(409).json({
          success: false,
          error: 'WhatsApp Cloud is not fully configured — set every cloud_* credential before switching.',
        });
      }
    }

    const rows = await query<{ config_value: string }>(
      `UPDATE wa_service_config
          SET config_value = $1, updated_at = NOW(), updated_by = $2
        WHERE config_key = 'wa_provider'
        RETURNING config_value`,
      [provider, actor]
    );

    const updated = rows[0];
    if (!updated) {
      return res.status(404).json({ success: false, error: 'wa_provider config row not found' });
    }

    // Best-effort audit, matching the existing WA admin routes: a wobbly audit
    // table must not make the caller think the flip failed when it did not.
    await recordFlip(provider, actor, req).catch((auditError: unknown) => {
      log.error('[WA Provider] Failed to audit provider flip', {
        provider,
        actor,
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
    });

    log.info('[WA Provider] 1:1 provider switched', { provider, actor });

    return res.status(200).json({ success: true, data: { provider: updated.config_value as Provider } });
  } catch (error) {
    log.error('[WA Provider API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function recordFlip(provider: Provider, actor: string | null, req: NextApiRequest): Promise<void> {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0] : null)
    ?? req.socket?.remoteAddress
    ?? null;

  await query(
    `INSERT INTO wa_admin_audit_log (action, entity_type, entity_id, old_value, new_value, user_email, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['update_config', 'config', 'wa_provider', null, JSON.stringify({ config_value: provider }), actor, ip]
  );
}

export default withAuth(withRole('super_admin')(handler));
