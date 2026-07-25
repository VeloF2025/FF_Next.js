/**
 * Go-live readiness for the WhatsApp Cloud provider.
 *
 * Read-only view of what an operator needs to know before flipping
 * `wa_provider` to `cloud`: which provider is active, and whether each Cloud
 * credential exists. Values are never read out of this module — only presence.
 *
 * @module communications/whatsapp/config/waGoLive
 */

import { query } from '@/lib/db-pool';
import type { WaProvider } from './waProviderConfig';

/** The four `wa_service_config` keys the Cloud sender needs, in display order. */
export const WA_CLOUD_CONFIG_KEYS = [
  'cloud_phone_number_id',
  'cloud_access_token',
  'cloud_app_secret',
  'cloud_verify_token',
] as const;

export type WaCloudConfigKey = (typeof WA_CLOUD_CONFIG_KEYS)[number];

export interface WaConfigPresence {
  key: WaCloudConfigKey;
  present: boolean;
}

export interface WaReadiness {
  provider: WaProvider;
  cloudConfig: WaConfigPresence[];
  /** True only when all four Cloud keys hold a non-blank value. */
  cloudConfigured: boolean;
}

/**
 * A type alias, not an interface: `query<T>` constrains T to `Record<string,
 * unknown>`, and only type aliases get the implicit index signature that
 * satisfies it.
 */
export type WaConfigRow = {
  config_key: string;
  config_value: string | null;
};

/**
 * Pure resolver — DB-free for testability.
 *
 * Blank and whitespace-only values count as absent, matching
 * `resolveWaCloudCreds`, so "configured" here means the same thing it means to
 * the sender.
 */
export function resolveWaReadiness(rows: WaConfigRow[]): WaReadiness {
  const map = new Map(rows.map((r) => [r.config_key, (r.config_value ?? '').trim()]));

  const cloudConfig: WaConfigPresence[] = WA_CLOUD_CONFIG_KEYS.map((key) => ({
    key,
    present: (map.get(key) ?? '') !== '',
  }));

  return {
    provider: map.get('wa_provider') === 'cloud' ? 'cloud' : 'bridge',
    cloudConfig,
    cloudConfigured: cloudConfig.every((c) => c.present),
  };
}

/** Read current readiness from `wa_service_config`. Never returns config values. */
export async function getWaReadiness(): Promise<WaReadiness> {
  const rows = await query<WaConfigRow>(
    `SELECT config_key, config_value
       FROM wa_service_config
      WHERE config_key = 'wa_provider' OR config_key = ANY($1)`,
    [[...WA_CLOUD_CONFIG_KEYS]]
  );
  return resolveWaReadiness(rows);
}
