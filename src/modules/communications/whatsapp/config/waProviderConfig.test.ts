import { describe, it, expect } from 'vitest';
import { resolveWaCloudCreds, WaCloudNotConfiguredError } from './waProviderConfig';

const rows = (o: Record<string, string>) =>
  Object.entries(o).map(([config_key, config_value]) => ({ config_key, config_value }));

describe('resolveWaCloudCreds', () => {
  it('returns creds when all four keys are present', () => {
    expect(resolveWaCloudCreds(rows({
      cloud_phone_number_id: 'PN1',
      cloud_access_token: 'TOK',
      cloud_app_secret: 'SEC',
      cloud_verify_token: 'VER',
    }))).toEqual({ phoneNumberId: 'PN1', accessToken: 'TOK', appSecret: 'SEC', verifyToken: 'VER' });
  });

  it('throws when a required key is missing or blank', () => {
    expect(() => resolveWaCloudCreds(rows({
      cloud_phone_number_id: 'PN1', cloud_access_token: '', cloud_app_secret: 'SEC', cloud_verify_token: 'VER',
    }))).toThrow(WaCloudNotConfiguredError);
    expect(() => resolveWaCloudCreds([])).toThrow(WaCloudNotConfiguredError);
  });
});
