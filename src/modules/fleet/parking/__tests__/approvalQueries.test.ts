import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const connectMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
  pool: { connect: (...a: unknown[]) => connectMock(...a) },
}));

import { loadPendingRequests } from '../approvalQueries';

beforeEach(() => {
  sqlMock.mockReset();
  connectMock.mockReset();
});

const ROW = {
  id: 'req-1',
  vehicle_id: 'veh-1',
  registration: 'LN40MGGP',
  driver_staff_id: 'staff-1',
  driver_name: 'Thabo M',
  req_lat: '-26.2041000',
  req_lon: '28.0473000',
  req_accuracy_m: '12',
  req_label: 'My yard',
  req_address_text: 'Braamfontein',
  cur_lat: null,
  cur_lon: null,
  cur_label: null,
  cur_address_text: null,
  request_note: null,
  created_at: '2026-08-06T10:00:00.000Z',
};

describe('loadPendingRequests', () => {
  it('parses the requested address as numbers', async () => {
    sqlMock.mockResolvedValue([ROW]);
    const [req] = await loadPendingRequests();
    expect(req!.requested).toMatchObject({ lat: -26.2041, lon: 28.0473, accuracyM: 12 });
  });

  // A first declaration has no current address; the UI must not render a
  // move distance of 0, which reads as "did not move".
  it('reports a null current address and a null move distance for a first declaration', async () => {
    sqlMock.mockResolvedValue([ROW]);
    const [req] = await loadPendingRequests();
    expect(req!.current).toBeNull();
    expect(req!.moveDistanceM).toBeNull();
  });

  it('computes the move distance when an address is already in force', async () => {
    sqlMock.mockResolvedValue([
      { ...ROW, cur_lat: '-26.2041000', cur_lon: '28.0473000', cur_label: 'Old yard' },
    ]);
    const [req] = await loadPendingRequests();
    expect(req!.current).toMatchObject({ lat: -26.2041, lon: 28.0473 });
    expect(req!.moveDistanceM).toBe(0);
  });

  it('rounds the move distance to whole metres', async () => {
    // ~111m north at this latitude.
    sqlMock.mockResolvedValue([{ ...ROW, cur_lat: '-26.2051000', cur_lon: '28.0473000' }]);
    const [req] = await loadPendingRequests();
    expect(Number.isInteger(req!.moveDistanceM)).toBe(true);
    expect(req!.moveDistanceM).toBeGreaterThan(80);
    expect(req!.moveDistanceM).toBeLessThan(140);
  });

  // accuracy_m is nullable; Number(null) is 0, which would tell an approver
  // the capture was perfect.
  it('keeps a null accuracy as null', async () => {
    sqlMock.mockResolvedValue([{ ...ROW, req_accuracy_m: null }]);
    const [req] = await loadPendingRequests();
    expect(req!.requested.accuracyM).toBeNull();
  });

  it('returns an empty list when nothing is pending', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await loadPendingRequests()).toEqual([]);
  });
});
