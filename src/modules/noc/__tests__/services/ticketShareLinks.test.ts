/**
 * ticketShareLinks unit tests
 *
 * Covers the share-URL helpers used by activate exports:
 * - input sanitization (null / non-uuid filtering, dedupe)
 * - getShareUrls: read-only, existing active tokens only
 * - getOrCreateShareUrls: reuse existing + mint only missing, fail-soft on INSERT
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { getShareUrls, getOrCreateShareUrls } from '../../services/ticketShareLinks';

const mockQuery = pool.query as unknown as Mock;

const ID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BASE = 'https://app.fibreflow.app/snag/resolve/';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getShareUrls', () => {
  it('returns an empty map and runs no query for empty / all-invalid input', async () => {
    expect((await getShareUrls([])).size).toBe(0);
    expect((await getShareUrls([null, undefined, 'not-a-uuid'])).size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('maps existing active tokens to share URLs (read-only, no insert)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ticket_id: ID_A, token: 'tok_a' }] });

    const urls = await getShareUrls([ID_A, ID_B]);

    expect(urls.get(ID_A)).toBe(`${BASE}tok_a`);
    expect(urls.has(ID_B)).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // Single read query; never an INSERT
    expect(mockQuery.mock.calls[0]?.[0]).toMatch(/SELECT/i);
    expect(mockQuery.mock.calls[0]?.[0]).not.toMatch(/INSERT/i);
  });

  it('dedupes and filters non-uuid ids before binding to the ::uuid[] cast', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getShareUrls([ID_A, ID_A, 'bad', null]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([[ID_A]]);
  });
});

describe('getOrCreateShareUrls', () => {
  it('reuses existing tokens without inserting when none are missing', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { ticket_id: ID_A, token: 'tok_a' },
        { ticket_id: ID_B, token: 'tok_b' },
      ],
    });

    const urls = await getOrCreateShareUrls([ID_A, ID_B]);

    expect(urls.get(ID_A)).toBe(`${BASE}tok_a`);
    expect(urls.get(ID_B)).toBe(`${BASE}tok_b`);
    expect(mockQuery).toHaveBeenCalledTimes(1); // SELECT only, no INSERT
  });

  it('mints a token only for ids missing an active token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ticket_id: ID_A, token: 'tok_a' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    const urls = await getOrCreateShareUrls([ID_A, ID_B]);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertSql = mockQuery.mock.calls[1]?.[0] as string;
    expect(insertSql).toMatch(/INSERT INTO snag_share_tokens/i);
    // Only the missing id (B) is inserted
    expect(mockQuery.mock.calls[1]?.[1]?.[1]).toEqual([ID_B]);
    // Reused token kept; minted token is a 48-char hex under the same base URL
    expect(urls.get(ID_A)).toBe(`${BASE}tok_a`);
    expect(urls.get(ID_B)).toMatch(new RegExp(`^${BASE}[0-9a-f]{48}$`));
  });

  it('fails soft: an INSERT error is logged and yields a partial map, never throws', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT: nothing existing
      .mockRejectedValueOnce(new Error('db down')); // INSERT blows up

    const urls = await getOrCreateShareUrls([ID_A]);

    expect(urls.size).toBe(0); // no link rather than a phantom token
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('short-circuits on empty input', async () => {
    expect((await getOrCreateShareUrls([])).size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
