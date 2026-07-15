import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { text: string; params: unknown[] };

const transactionMock = vi.fn();
let calls: Call[];

vi.mock('@/lib/db-pool', () => ({
  transaction: (...a: unknown[]) => transactionMock(...a),
}));

import { setVehicleTracker } from '../trackerQueries';

describe('setVehicleTracker', () => {
  beforeEach(() => {
    calls = [];
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (callback: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        query: async (text: string, params: unknown[] = []) => {
          calls.push({ text, params });
          return [];
        },
        queryOne: async (text: string, params: unknown[] = []) => {
          calls.push({ text, params });
          return null;
        },
      };
      return callback(txn);
    });
  });

  it('deactivates the existing tracker before inserting a new one, in one transaction', async () => {
    await setVehicleTracker({
      vehicleId: 'v-1', provider: 'cartrack', accountRef: 'acct', externalId: 'ct-9',
    });

    // Both statements must run inside a single transaction call — not as
    // two separate autocommit statements — so a failing insert can't leave
    // the deactivate committed.
    expect(transactionMock).toHaveBeenCalledTimes(1);

    // Exactly 2 statements, and order matters: the partial unique index
    // (one active tracker per vehicle) makes deactivate-before-insert
    // load-bearing.
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toMatch(/UPDATE fleet_vehicle_trackers[\s\S]*is_active = false/i);
    expect(calls[0].text).toMatch(/updated_at = now\(\)/i);
    expect(calls[1].text).toMatch(/INSERT INTO fleet_vehicle_trackers/i);
  });

  it('only deactivates when externalId is null (unmapping)', async () => {
    await setVehicleTracker({
      vehicleId: 'v-1', provider: 'cartrack', accountRef: 'acct', externalId: null,
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/UPDATE fleet_vehicle_trackers[\s\S]*is_active = false/i);
  });
});
