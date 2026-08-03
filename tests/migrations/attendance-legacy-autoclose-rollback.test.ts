import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  applyRemediation, planRemediation,
} from '../../src/services/attendance/remediation/legacyAutocloseReset';
import { rollbackRemediation } from '../../src/services/attendance/remediation/legacyAutocloseRollback';
import { createHarness, ENTRY, STAFF } from './setup/autoclose-fixture';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const h = createHarness('autoclose_rollback_scratch', DATABASE_URL);
const { client } = h;

async function applyOnce(day = '2026-05-04'): Promise<void> {
  await h.seedFabricated(ENTRY(1), STAFF(1), day);
  await applyRemediation(client, (await planRemediation(client)).candidates);
}

dbDescribe('legacy auto-close remediation — rollback', () => {
  beforeAll(() => h.setup(), 60_000);
  afterAll(async () => expect(await h.teardown()).toBe(0), 60_000);
  beforeEach(() => h.reset());

  it('restores the entry and hours, and strips only its own note line', async () => {
    await applyOnce();
    await client.query(
      `UPDATE attendance_entries SET notes = notes || E'\nsupervisor followed up'
       WHERE id = $1::uuid`, [ENTRY(1)]);

    const result = await rollbackRemediation(client);

    expect(result.applied).toBe(true);
    const { rows } = await client.query<{ clock_out_at: Date; notes: string }>(
      `SELECT clock_out_at, notes FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].clock_out_at.toISOString()).toBe('2026-05-04T15:00:00.000Z');
    expect(rows[0].notes).toBe('original note\nsupervisor followed up');
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(9);
  });

  // When notes was NULL at apply time the marker is written with no leading
  // newline, so a strip that only handles the "\n<marker>" form leaves it
  // permanently stuck to the record.
  it('strips its note and restores an entry whose notes were empty at apply time', async () => {
    await h.seedFabricated(ENTRY(1), STAFF(1), '2026-05-04');
    await client.query(`UPDATE attendance_entries SET notes = NULL WHERE id = $1::uuid`, [ENTRY(1)]);
    await applyRemediation(client, (await planRemediation(client)).candidates);
    await client.query(
      `UPDATE attendance_entries SET notes = notes || E'\nlater note' WHERE id = $1::uuid`, [ENTRY(1)]);

    await rollbackRemediation(client);

    const { rows } = await client.query<{ notes: string | null; clock_out_at: Date | null }>(
      `SELECT notes, clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].notes).toBe('later note');
    expect(rows[0].clock_out_at).not.toBeNull();
  });

  it('leaves a recomputed summary alone and reports it', async () => {
    await applyOnce();
    await client.query(
      `UPDATE attendance_daily_summaries SET regular_hrs = 8.00 WHERE staff_id = $1::uuid`, [STAFF(1)]);

    const result = await rollbackRemediation(client);

    expect(result.skippedChangedSummaries).toBe(1);
    expect(result.summariesRestored).toBe(0);
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(8);
  });

  it('reports it did nothing when the remediation was never applied', async () => {
    expect((await rollbackRemediation(client)).applied).toBe(false);
  });

  it('is idempotent — a second rollback changes nothing further', async () => {
    await applyOnce();
    const first = await rollbackRemediation(client);
    const second = await rollbackRemediation(client);

    expect(first.entriesRestored).toBe(1);
    expect(second.entriesRestored).toBe(0);
    expect(second.notesStripped).toBe(0);
    expect(await h.hours(STAFF(1), '2026-05-04')).toBe(9);
  });

  // The entry restore keys on this remediation's own marker, so an entry left
  // open-ended for any other reason must not have the fabricated 9h stamped on.
  it('does not restore an entry whose remediation note is gone', async () => {
    await applyOnce();
    await client.query(`UPDATE attendance_entries SET notes = NULL WHERE id = $1::uuid`, [ENTRY(1)]);

    const result = await rollbackRemediation(client);

    expect(result.entriesRestored).toBe(0);
    const { rows } = await client.query<{ clock_out_at: Date | null }>(
      `SELECT clock_out_at FROM attendance_entries WHERE id = $1::uuid`, [ENTRY(1)]);
    expect(rows[0].clock_out_at).toBeNull();
  });
});
