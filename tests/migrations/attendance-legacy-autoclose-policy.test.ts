import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  backdatePolicy, restorePolicy,
} from '../../src/services/attendance/remediation/legacyAutocloseRollback';
import { createHarness, POLICY_ID } from './setup/autoclose-fixture';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DATABASE_URL ? describe : describe.skip;
const h = createHarness('autoclose_policy_scratch', DATABASE_URL);
const { client } = h;

/**
 * The policy backdate is deliberately a separate operation from the evidence
 * cleanup — it is the step that makes history visible to the reconciler, and
 * the nightly cron's trailing window will start reprojecting it. Its tests are
 * separate for the same reason: it needs none of the attendance fixtures.
 */
dbDescribe('legacy auto-close remediation — policy backdate', () => {
  beforeAll(() => h.setup(), 60_000);
  afterAll(async () => expect(await h.teardown()).toBe(0), 60_000);
  beforeEach(() => h.reset());

  it('backdates by captured id and restores the captured value exactly', async () => {
    const applied = await backdatePolicy(client, '2026-04-25');
    expect(applied).toMatchObject({
      policyId: POLICY_ID, previousActiveFrom: '2026-08-03', newActiveFrom: '2026-04-25',
    });

    const restored = await restorePolicy(client);

    expect(restored?.newActiveFrom).toBe('2026-08-03');
    const { rows } = await client.query<{ active_from: string }>(
      `SELECT TO_CHAR(active_from, 'YYYY-MM-DD') AS active_from FROM attendance_schedule_policies`);
    expect(rows[0].active_from).toBe('2026-08-03');
  });

  // Targeting a captured id rather than a literal date is what stops a restore
  // stamping a fabricated value onto a policy the backdate never touched.
  it('restores the original value even after the policy moved again', async () => {
    await backdatePolicy(client, '2026-04-25');
    await client.query(
      `UPDATE attendance_schedule_policies SET active_from = DATE '2026-01-01'`);

    const restored = await restorePolicy(client);

    expect(restored?.newActiveFrom).toBe('2026-08-03');
  });

  it('refuses to backdate when the open policy is not unique', async () => {
    await client.query(
      `INSERT INTO attendance_schedule_policies (id, active_from)
       VALUES ('40000000-0000-4000-8000-000000000001'::uuid, DATE '2026-09-01')`);

    await expect(backdatePolicy(client, '2026-04-25')).rejects.toThrow('found 2');
  });

  it('rejects a malformed date instead of coercing it', async () => {
    await expect(backdatePolicy(client, '25-04-2026')).rejects.toThrow('YYYY-MM-DD');
  });

  it('reports nothing to restore when no backdate was ever applied', async () => {
    expect(await restorePolicy(client)).toBeNull();
  });
});
