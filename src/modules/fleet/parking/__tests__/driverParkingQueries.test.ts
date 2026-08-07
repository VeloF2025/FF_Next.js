import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import {
  loadDriverParkingState,
  resolveDriverVehicle,
  withdrawPendingDeclaration,
} from '../driverParkingQueries';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('resolveDriverVehicle', () => {
  it('returns null when the driver has no active assignment', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await resolveDriverVehicle('staff-1')).toBeNull();
  });

  it('maps the joined row', async () => {
    sqlMock.mockResolvedValue([{ vehicle_id: 'veh-1', registration: 'LN40MGGP' }]);
    expect(await resolveDriverVehicle('staff-1')).toEqual({
      vehicleId: 'veh-1',
      registration: 'LN40MGGP',
    });
  });
});

describe('loadDriverParkingState', () => {
  // node-postgres hands back NUMERIC as a string. A declaration whose lat
  // stayed "-26.2041000" would render fine and compare wrong.
  it('parses numeric columns into numbers', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'loc-1',
        status: 'active',
        lat: '-26.2041000',
        lon: '28.0473000',
        accuracy_m: '11.5',
        radius_m: 200,
        label: 'My yard',
        address_text: 'Braamfontein, Johannesburg',
        request_note: null,
        decision_note: null,
        effective_from: '2026-08-01T10:00:00.000Z',
        decided_at: '2026-08-01T10:00:00.000Z',
        created_at: '2026-07-31T18:00:00.000Z',
      },
    ]);

    const state = await loadDriverParkingState('veh-1');

    expect(state.active).toMatchObject({
      id: 'loc-1',
      lat: -26.2041,
      lon: 28.0473,
      accuracyM: 11.5,
      radiusM: 200,
    });
    expect(state.pending).toBeNull();
    expect(state.history).toEqual([]);
  });

  it('splits active, pending and history out of one result set', async () => {
    const base = {
      lat: '-26.2',
      lon: '28.0',
      accuracy_m: '10',
      radius_m: 200,
      label: null,
      address_text: null,
      request_note: null,
      decision_note: null,
      effective_from: null,
      decided_at: null,
      created_at: '2026-08-01T00:00:00.000Z',
    };
    sqlMock.mockResolvedValue([
      { ...base, id: 'p', status: 'pending' },
      { ...base, id: 'a', status: 'active' },
      { ...base, id: 'r', status: 'rejected' },
      { ...base, id: 's', status: 'superseded' },
    ]);

    const state = await loadDriverParkingState('veh-1');

    expect(state.active?.id).toBe('a');
    expect(state.pending?.id).toBe('p');
    expect(state.history.map((h) => h.id)).toEqual(['r', 's']);
  });

  it('returns nulls when the vehicle has no declarations at all', async () => {
    sqlMock.mockResolvedValue([]);
    const state = await loadDriverParkingState('veh-1');
    expect(state).toEqual({ active: null, pending: null, history: [] });
  });

  // accuracy_m is nullable in migration 483; Number(null) is 0, which would
  // silently claim a perfect fix.
  it('keeps a null accuracy as null rather than coercing it to zero', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'loc-1',
        status: 'active',
        lat: '-26.2',
        lon: '28.0',
        accuracy_m: null,
        radius_m: 200,
        label: null,
        address_text: null,
        request_note: null,
        decision_note: null,
        effective_from: null,
        decided_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ]);
    const state = await loadDriverParkingState('veh-1');
    expect(state.active?.accuracyM).toBeNull();
  });

  // pg returns timestamptz as a Date. The client renders these as ISO strings.
  it('normalises Date columns to ISO strings', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'loc-1',
        status: 'active',
        lat: '-26.2',
        lon: '28.0',
        accuracy_m: '10',
        radius_m: 200,
        label: null,
        address_text: null,
        request_note: null,
        decision_note: null,
        effective_from: new Date('2026-08-01T10:00:00.000Z'),
        decided_at: null,
        created_at: new Date('2026-07-31T18:00:00.000Z'),
      },
    ]);
    const state = await loadDriverParkingState('veh-1');
    expect(state.active?.effectiveFrom).toBe('2026-08-01T10:00:00.000Z');
    expect(state.active?.createdAt).toBe('2026-07-31T18:00:00.000Z');
  });
});

describe('withdrawPendingDeclaration', () => {
  it('reports true when a row was withdrawn', async () => {
    sqlMock.mockResolvedValue([{ id: 'loc-1' }]);
    expect(await withdrawPendingDeclaration('veh-1', 'staff-1')).toBe(true);
  });

  it('reports false when there was nothing open', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await withdrawPendingDeclaration('veh-1', 'staff-1')).toBe(false);
  });
});
