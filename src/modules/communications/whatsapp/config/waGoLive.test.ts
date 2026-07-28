import { describe, it, expect } from 'vitest';
import { resolveWaReadiness, WA_CLOUD_CONFIG_KEYS } from './waGoLive';

/** Row shape as returned by `SELECT config_key, config_value FROM wa_service_config`. */
function rows(pairs: Record<string, string>) {
  return Object.entries(pairs).map(([config_key, config_value]) => ({ config_key, config_value }));
}

const FULL_CLOUD = {
  cloud_phone_number_id: '123456789',
  cloud_access_token: 'EAAG-secret-token',
  cloud_app_secret: 'app-secret-value',
  cloud_verify_token: 'verify-token-value',
};

describe('resolveWaReadiness', () => {
  it('reports the configured provider', () => {
    expect(resolveWaReadiness(rows({ wa_provider: 'cloud' })).provider).toBe('cloud');
    expect(resolveWaReadiness(rows({ wa_provider: 'bridge' })).provider).toBe('bridge');
  });

  it('defaults to bridge when wa_provider is missing or unrecognised', () => {
    expect(resolveWaReadiness([]).provider).toBe('bridge');
    expect(resolveWaReadiness(rows({ wa_provider: 'waha' })).provider).toBe('bridge');
  });

  it('reports every cloud key as absent when none are set', () => {
    const r = resolveWaReadiness(rows({ wa_provider: 'bridge' }));
    expect(r.cloudConfig.map((c) => c.key)).toEqual([...WA_CLOUD_CONFIG_KEYS]);
    expect(r.cloudConfig.every((c) => c.present === false)).toBe(true);
    expect(r.cloudConfigured).toBe(false);
  });

  it('treats an empty or whitespace-only value as absent', () => {
    const r = resolveWaReadiness(rows({ ...FULL_CLOUD, cloud_app_secret: '   ' }));
    const appSecret = r.cloudConfig.find((c) => c.key === 'cloud_app_secret');
    expect(appSecret?.present).toBe(false);
    expect(r.cloudConfigured).toBe(false);
  });

  it('is configured only when all four cloud keys are present', () => {
    expect(resolveWaReadiness(rows(FULL_CLOUD)).cloudConfigured).toBe(true);
    const { cloud_verify_token: _omitted, ...threeOfFour } = FULL_CLOUD;
    expect(resolveWaReadiness(rows(threeOfFour)).cloudConfigured).toBe(false);
  });

  // The whole point of the readiness panel: an operator sees whether a
  // credential exists, never what it is. A regression here leaks live Meta
  // creds to every manager-level user.
  it('never echoes a config value back in the result', () => {
    const r = resolveWaReadiness(rows({ ...FULL_CLOUD, wa_provider: 'cloud' }));
    const serialised = JSON.stringify(r);
    for (const secret of Object.values(FULL_CLOUD)) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('ignores unrelated config rows', () => {
    const r = resolveWaReadiness(rows({ ...FULL_CLOUD, bridge_url: 'http://example', vps_password: 'hunter2' }));
    expect(r.cloudConfig).toHaveLength(4);
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
});
