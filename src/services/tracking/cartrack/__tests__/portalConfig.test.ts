/**
 * The gating is the whole point of this module: an absent config is a valid
 * deployment, a PARTIAL one is a fault that would otherwise be indistinguishable
 * from a healthy tick.
 */
import { describe, expect, it, vi } from 'vitest';
import { cartrackPortalFromEnv } from '../portalConfig';

vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const { log } = await import('@/lib/logger');

const FULL = {
  CARTRACK_PORTAL_ACCOUNT: 'UREN00016',
  CARTRACK_PORTAL_SUBUSER: 'BLITZ',
  CARTRACK_PORTAL_PASS: 'secret123',
} as NodeJS.ProcessEnv;

describe('cartrackPortalFromEnv', () => {
  it('builds the provider when all three are present', () => {
    const c = cartrackPortalFromEnv(FULL);
    expect(c?.provider.key).toBe('cartrack');
    expect(c?.provider.accountRef).toBe('urent');
    expect(c?.provider.granularity).toBe('snapshot');
    expect(typeof c?.feedFreshness).toBe('function');
  });

  it('honours an explicit account ref', () => {
    expect(cartrackPortalFromEnv({ ...FULL, CARTRACK_PORTAL_ACCOUNT_REF: 'other' })?.provider.accountRef)
      .toBe('other');
  });

  it('is silent when NOTHING is configured — that is a valid deployment', () => {
    vi.mocked(log.warn).mockClear();
    expect(cartrackPortalFromEnv({})).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['ACCOUNT only', { CARTRACK_PORTAL_ACCOUNT: 'A' }],
    ['SUBUSER only', { CARTRACK_PORTAL_SUBUSER: 'B' }],
    // The regression: a PASS-only config once fell through both branches and
    // was dropped in total silence.
    ['PASS only', { CARTRACK_PORTAL_PASS: 'C' }],
    ['URL only', { CARTRACK_PORTAL_URL: 'https://x' }],
    ['missing PASS', { CARTRACK_PORTAL_ACCOUNT: 'A', CARTRACK_PORTAL_SUBUSER: 'B' }],
    ['missing SUBUSER', { CARTRACK_PORTAL_ACCOUNT: 'A', CARTRACK_PORTAL_PASS: 'C' }],
  ])('warns loudly on a partial config: %s', (_label, env) => {
    vi.mocked(log.warn).mockClear();
    expect(cartrackPortalFromEnv(env as NodeJS.ProcessEnv)).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [, meta] = vi.mocked(log.warn).mock.calls[0] as [string, { missing: string[] }];
    expect(meta.missing.length).toBeGreaterThan(0);
  });
});
