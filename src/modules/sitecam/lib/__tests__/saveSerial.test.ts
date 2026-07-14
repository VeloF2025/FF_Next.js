import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { saveSerial } from '../saveSerial';

const input = { drNumber: 'DR1', step: 6, device: 'ups' as const, scannedSerial: 'GU18W12V2508057584', attemptNumber: 1 };

describe('saveSerial', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a saved result and sends the device in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { result: 'saved', serial: 'GU18W12V2508057584', message: 'ok', crossRefStatus: 'pending' } }),
    });
    global.fetch = fetchMock;

    const r = await saveSerial(input);
    expect(r).toEqual({ kind: 'saved', serial: 'GU18W12V2508057584', message: 'ok', crossRefStatus: 'pending' });
    expect(fetchMock.mock.calls[0][1].body).toContain('"device":"ups"');
  });

  it('maps a server invalid_format to an invalid result', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { result: 'invalid_format', serial: 'X', message: 'wrong prefix' } }),
    });
    const r = await saveSerial(input);
    expect(r).toEqual({ kind: 'invalid', message: 'wrong prefix' });
  });

  it('maps a non-OK response to an error result', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) });
    const r = await saveSerial(input);
    expect(r.kind).toBe('error');
  });

  it('maps a network rejection to an error result (nothing thrown)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await saveSerial(input);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/Network error while saving/);
  });
});
