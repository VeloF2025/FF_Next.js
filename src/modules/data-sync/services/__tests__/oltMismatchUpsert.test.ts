/**
 * Tests for resolveMatchedDrop — the shared match-branch auto-resolve both
 * queue-processing paths (endpoint + continuation service) now call. These lock
 * the SAFETY SCOPING of the UPDATE so it can never silently widen: it must skip
 * ticketed rows and human-review verdicts, touching only auto-detected states.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { resolveMatchedDrop } from '../oltMismatchUpsert';

function mockClient() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  return { client: { query } as unknown as PoolClient, query };
}

describe('resolveMatchedDrop', () => {
  it('issues exactly one UPDATE bound to the drop number', async () => {
    const { client, query } = mockClient();
    await resolveMatchedDrop(client, 'DR123456');
    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['DR123456']);
  });

  it('resolves with the auto_verified_match audit fields', async () => {
    const { client, query } = mockClient();
    await resolveMatchedDrop(client, 'DR123456');
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE olt_mismatch_records/);
    expect(sql).toMatch(/fix_status = 'resolved'/);
    expect(sql).toMatch(/resolution_type = 'auto_verified_match'/);
    expect(sql).toMatch(/resolved_at = NOW\(\)/);
  });

  it('only ever touches auto-detected states — never ticketed or human-review rows', async () => {
    const { client, query } = mockClient();
    await resolveMatchedDrop(client, 'DR123456');
    const [sql] = query.mock.calls[0];
    // Ticket guard: NOC owns the lifecycle of any rows with an open ticket.
    expect(sql).toMatch(/maintenance_ticket_id IS NULL/);
    // Whitelist: only auto-detected verdicts are auto-closed.
    expect(sql).toMatch(/fix_status IN \('pending','not_found','empty_serial','serial_other_dr'\)/);
    // Human-review verdicts must NOT be in the whitelist.
    expect(sql).not.toMatch(/needs_investigation/);
    expect(sql).not.toMatch(/needs_reinvestigation/);
  });
});
