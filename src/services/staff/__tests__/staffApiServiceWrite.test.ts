/**
 * Tests for the staff write path in staffApiService.
 *
 * Two gaps this pins, both of which were silent:
 *   - the PUT payload is an explicit whitelist, so a field added to the form
 *     and to the SQL still reaches nothing unless it is mapped here. A save
 *     "succeeded" while discarding what the user typed.
 *   - handleResponse read a top-level `message`, which neither error envelope
 *     the staff endpoints emit actually has, so every rejected save surfaced as
 *     "HTTP 400"/"HTTP 500" instead of the reason.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { staffApiService } from '../staffApiService';

const STAFF_ID = '5ec63f0f-c3e6-4cf5-b3d7-b169c86ecf1d';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function sentBody(fn: ReturnType<typeof mockFetch>): Record<string, unknown> {
  return JSON.parse(fn.mock.calls[0][1].body as string);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('staffApiService.update payload', () => {
  it('sends nationality to the server', async () => {
    const fetchMock = mockFetch(200, { success: true, data: { id: STAFF_ID } });
    await staffApiService.update(STAFF_ID, { nationality: 'Malawian' });
    expect(sentBody(fetchMock).nationality).toBe('Malawian');
  });

  it('sends an emptied nationality so it can be cleared', async () => {
    const fetchMock = mockFetch(200, { success: true, data: { id: STAFF_ID } });
    await staffApiService.update(STAFF_ID, { nationality: '' });
    expect(sentBody(fetchMock)).toHaveProperty('nationality', '');
  });

  it('omits nationality when it was not part of the update', async () => {
    const fetchMock = mockFetch(200, { success: true, data: { id: STAFF_ID } });
    await staffApiService.update(STAFF_ID, { position: 'Technician' });
    expect(sentBody(fetchMock)).not.toHaveProperty('nationality');
  });
});

describe('staffApiService error messages', () => {
  it('surfaces the message from the apiResponse envelope', async () => {
    mockFetch(400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid SA ID number: too long' },
    });
    await expect(staffApiService.update(STAFF_ID, { saIdNumber: 'x' })).rejects.toThrow(
      'Invalid SA ID number: too long'
    );
  });

  it('surfaces the message from the plain { error: string } shape', async () => {
    mockFetch(409, { success: false, error: 'Employee ID already exists.' });
    await expect(staffApiService.update(STAFF_ID, {})).rejects.toThrow(
      'Employee ID already exists.'
    );
  });

  it('falls back to the status code when the body carries no message', async () => {
    mockFetch(503, { success: false });
    await expect(staffApiService.update(STAFF_ID, {})).rejects.toThrow('HTTP 503');
  });

  it('falls back to the status code when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      })
    );
    await expect(staffApiService.update(STAFF_ID, {})).rejects.toThrow('HTTP 502');
  });
});
