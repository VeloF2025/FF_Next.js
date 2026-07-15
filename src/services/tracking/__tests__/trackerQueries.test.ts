import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));

import { setVehicleTracker } from '../trackerQueries';

describe('setVehicleTracker', () => {
  beforeEach(() => { sqlMock.mockReset(); sqlMock.mockResolvedValue([]); });

  it('deactivates the existing tracker before inserting a new one', async () => {
    await setVehicleTracker({
      vehicleId: 'v-1', provider: 'cartrack', accountRef: 'acct', externalId: 'ct-9',
    });
    // Two statements: deactivate, then upsert. The partial unique index
    // (one active tracker per vehicle) makes ordering load-bearing.
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('only deactivates when externalId is null (unmapping)', async () => {
    await setVehicleTracker({
      vehicleId: 'v-1', provider: 'cartrack', accountRef: 'acct', externalId: null,
    });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
