import { describe, it, expect, vi } from 'vitest';
import { netstarProvider } from '../provider';

describe('netstarProvider', () => {
  it('declares itself as the netstar provider', () => {
    const p = netstarProvider({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      accountRef: 'europcar',
      client: { listVehicles: vi.fn(), fetchPositions: vi.fn(async () => []) },
    });
    expect(p.key).toBe('netstar');
    expect(p.accountRef).toBe('europcar');
  });

  it('asks the client only for vehicles mapped in fleet_vehicle_trackers', async () => {
    const fetchPositions = vi.fn(async () => []);
    const p = netstarProvider({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      accountRef: 'europcar',
      client: { listVehicles: vi.fn(), fetchPositions },
      loadMappedVehicles: async () => [{ externalId: '1447952', registration: 'LN40MGGP' }],
    });
    await p.fetchPositions(new Date('2026-08-01'), new Date('2026-08-02'));
    expect(fetchPositions).toHaveBeenCalledWith(
      new Date('2026-08-01'), new Date('2026-08-02'),
      [{ externalId: '1447952', registration: 'LN40MGGP' }]
    );
  });

  it('skips the request entirely when nothing is mapped', async () => {
    const fetchPositions = vi.fn(async () => []);
    const p = netstarProvider({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      accountRef: 'europcar',
      client: { listVehicles: vi.fn(), fetchPositions },
      loadMappedVehicles: async () => [],
    });
    expect(await p.fetchPositions(new Date('2026-08-01'), new Date('2026-08-02'))).toEqual([]);
    expect(fetchPositions).not.toHaveBeenCalled();
  });
});
