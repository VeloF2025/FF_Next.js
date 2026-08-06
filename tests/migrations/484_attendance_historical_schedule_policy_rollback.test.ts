/**
 * Integration test for migration 484 — rollback path.
 *
 * Split from the forward suite to keep both files under the 300-line limit.
 * Uses its own scratch schema so the two suites cannot see each other's rows.
 *
 * The behaviour that matters: the rollback must refuse while any projection
 * still references the policy. Both referencing foreign keys are NO ACTION, so
 * a bare DELETE would emit a 23503 naming neither table nor count, and clearing
 * schedule_policy_id would destroy the record of which schedule priced each day.
 *
 * Requires TEST_DATABASE_URL env var (see .env.local.example).
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
    'See .env.local.example.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createPool, fixture, HISTORICAL_NAME } from './setup/mig484-fixture';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_FILE = '484_attendance_historical_schedule_policy.sql';
const FORWARD = readFileSync(join(SQL_DIR, FORWARD_FILE), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_484_attendance_historical_schedule_policy.sql'), 'utf8',
);

const pool = createPool();
const fx = fixture(pool, 'mig484_rollback_scratch');

/** Apply the forward migration and record it in the tracker, as the runner does. */
async function applyForward(): Promise<void> {
  await fx.seedCurrentPolicy();
  const err = await fx.attempt(FORWARD);
  if (err) throw new Error(`forward migration failed unexpectedly: ${err}`);
  await fx.scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);
}

beforeAll(fx.createSchema);
beforeEach(fx.resetTables);
afterAll(async () => {
  await fx.dropSchema();
  await pool.end();
});

describe('migration 484 — rollback', () => {
  it('removes the policy and clears its own tracker row', async () => {
    await applyForward();

    expect(await fx.attempt(ROLLBACK)).toBe('');

    expect(await fx.historical()).toBeUndefined();
    expect(await fx.trackerCount(FORWARD_FILE)).toBe(0);
    // The current policy is untouched — the rollback is scoped to its own row.
    expect(await fx.policies()).toHaveLength(1);
  });

  it('refuses while daily summaries still reference the policy', async () => {
    await applyForward();
    const id = await fx.policyId(HISTORICAL_NAME);
    await fx.scoped(
      `INSERT INTO attendance_daily_summaries (staff_id, work_date, schedule_policy_id)
       VALUES (gen_random_uuid(), DATE '2026-05-15', $1::uuid)`,
      [id],
    );

    const message = await fx.attempt(ROLLBACK);

    expect(message).toContain('Rollback 484');
    expect(message).toContain('used to project');
    // Must not half-roll-back: policy present, tracker intact.
    expect(await fx.historical()).toBeDefined();
    expect(await fx.trackerCount(FORWARD_FILE)).toBe(1);
  });

  it('refuses while reconciliation runs still reference the policy', async () => {
    await applyForward();
    const id = await fx.policyId(HISTORICAL_NAME);
    await fx.scoped(
      `INSERT INTO attendance_reconciliation_runs (schedule_policy_id) VALUES ($1::uuid)`,
      [id],
    );

    const message = await fx.attempt(ROLLBACK);

    expect(message).toContain('Rollback 484');
    expect(await fx.historical()).toBeDefined();
    expect(await fx.trackerCount(FORWARD_FILE)).toBe(1);
  });

  it('reports both reference counts in the failure message', async () => {
    await applyForward();
    const id = await fx.policyId(HISTORICAL_NAME);
    await fx.scoped(
      `INSERT INTO attendance_daily_summaries (staff_id, work_date, schedule_policy_id)
       VALUES (gen_random_uuid(), DATE '2026-05-15', $1::uuid),
              (gen_random_uuid(), DATE '2026-05-16', $1::uuid)`,
      [id],
    );
    await fx.scoped(
      `INSERT INTO attendance_reconciliation_runs (schedule_policy_id) VALUES ($1::uuid)`,
      [id],
    );

    const message = await fx.attempt(ROLLBACK);

    // The operator has to decide what happens to the projections, so the counts
    // are the actionable part of the error.
    expect(message).toContain('2 attendance_daily_summaries');
    expect(message).toContain('1 attendance_reconciliation_runs');
  });

  it('succeeds once the referencing projections are gone', async () => {
    await applyForward();
    const id = await fx.policyId(HISTORICAL_NAME);
    await fx.scoped(
      `INSERT INTO attendance_daily_summaries (staff_id, work_date, schedule_policy_id)
       VALUES (gen_random_uuid(), DATE '2026-05-15', $1::uuid)`,
      [id],
    );
    expect(await fx.attempt(ROLLBACK)).toContain('Rollback 484');

    await fx.scoped(`DELETE FROM attendance_daily_summaries`);

    expect(await fx.attempt(ROLLBACK)).toBe('');
    expect(await fx.historical()).toBeUndefined();
    expect(await fx.trackerCount(FORWARD_FILE)).toBe(0);
  });

  it('is re-runnable', async () => {
    await applyForward();
    await fx.attempt(ROLLBACK);

    expect(await fx.attempt(ROLLBACK)).toBe('');
    expect(await fx.historical()).toBeUndefined();
  });

  it('clears a stale tracker row even when the policy is already absent', async () => {
    // Converges a partially-applied state rather than leaving schema_migrations
    // claiming 484 is applied while the row it created is gone.
    await fx.seedCurrentPolicy();
    await fx.scoped(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [FORWARD_FILE]);

    expect(await fx.attempt(ROLLBACK)).toBe('');
    expect(await fx.trackerCount(FORWARD_FILE)).toBe(0);
  });

  it('lets the forward migration re-apply cleanly afterwards', async () => {
    await applyForward();
    await fx.attempt(ROLLBACK);

    expect(await fx.attempt(FORWARD)).toBe('');
    expect(await fx.historical()).toBeDefined();
  });
});
