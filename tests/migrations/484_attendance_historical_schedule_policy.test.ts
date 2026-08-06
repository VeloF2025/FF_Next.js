/**
 * Integration test for migration 484 — forward path.
 *
 * Executes the real SQL file against an ephemeral Postgres in a scratch schema
 * (see tests/migrations/setup/global-setup.ts), so the file itself is exercised
 * rather than whatever shape a live database is in. Rollback behaviour lives in
 * 484_attendance_historical_schedule_policy_rollback.test.ts.
 *
 * The behaviour that matters is coverage without overlap. findEffectivePolicy()
 * resolves with ORDER BY active_from DESC LIMIT 1, so two rows covering one date
 * silently pick a winner instead of failing — which is why active_to is derived
 * from the existing boundary rather than hardcoded, and why that derivation is
 * tested against a boundary other than the production one.
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
import {
  createPool, fixture, ERA_START, CUTOVER, HISTORICAL_NAME,
} from './setup/mig484-fixture';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(
  join(SQL_DIR, '484_attendance_historical_schedule_policy.sql'), 'utf8',
);

const pool = createPool();
const fx = fixture(pool, 'mig484_scratch');

const runForward = () => fx.attempt(FORWARD);

beforeAll(fx.createSchema);
beforeEach(fx.resetTables);
afterAll(async () => {
  await fx.dropSchema();
  await pool.end();
});

describe('migration 484 — forward', () => {
  it('covers the era from the first attendance record to the day before cutover', async () => {
    await fx.seedCurrentPolicy();
    expect(await runForward()).toBe('');

    const row = await fx.historical();
    expect(row).toBeDefined();
    expect(row!.active_from).toBe(ERA_START);
    expect(row!.active_to).toBe('2026-08-02');
  });

  it('leaves no uncovered day between the two policies', async () => {
    await fx.seedCurrentPolicy();
    await runForward();

    const [historicalRow, current] = await fx.policies();
    expect(historicalRow!.name).toBe(HISTORICAL_NAME);
    const gap = await fx.scoped<{ gap: string }>(
      `SELECT ($2::date - $1::date)::text AS gap`,
      [historicalRow!.active_to, current!.active_from],
    );
    expect(gap[0]!.gap).toBe('1'); // exactly adjacent, no missing day
  });

  it('never overlaps the existing policy', async () => {
    await fx.seedCurrentPolicy();
    await runForward();

    // An overlap is silent — findEffectivePolicy takes ORDER BY active_from DESC
    // LIMIT 1 — so assert it structurally rather than trusting the dates.
    const overlaps = await fx.scoped<{ n: string }>(`
      SELECT COUNT(*)::text AS n
      FROM attendance_schedule_policies a
      JOIN attendance_schedule_policies b ON b.id <> a.id
      WHERE a.active_from <= COALESCE(b.active_to, DATE '9999-12-31')
        AND COALESCE(a.active_to, DATE '9999-12-31') >= b.active_from`);
    expect(Number(overlaps[0]!.n)).toBe(0);
  });

  it('derives active_to from the existing boundary rather than hardcoding it', async () => {
    // The production boundary is 2026-08-03. If active_to were hardcoded to
    // 2026-08-02 this case would leave a two-week gap and still pass the first
    // test, so it is the one that pins the derivation.
    await fx.seedCurrentPolicy('2026-08-17');
    expect(await runForward()).toBe('');
    expect((await fx.historical())!.active_to).toBe('2026-08-16');
  });

  it('does not create a second open-ended policy', async () => {
    await fx.seedCurrentPolicy();
    await runForward();

    const open = await fx.scoped<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM attendance_schedule_policies WHERE active_to IS NULL`,
    );
    expect(Number(open[0]!.n)).toBe(1);
  });

  it('carries the same schedule and overtime rule as the current policy', async () => {
    await fx.seedCurrentPolicy();
    await runForward();

    const row = await fx.historical();
    expect(row!.weekday_start).toBe('08:00:00');
    expect(row!.weekday_end).toBe('17:00:00');
    expect(row!.overtime_rule_id).toBe('600f80f0-593a-4f31-a434-cfeeeccda7c6');
  });

  it('is a no-op when the era is already covered', async () => {
    await fx.seedCurrentPolicy(ERA_START);
    expect(await runForward()).toBe('');

    expect(await fx.historical()).toBeUndefined();
    expect(await fx.policies()).toHaveLength(1);
  });

  it('is a no-op when an earlier policy already starts before the era', async () => {
    await fx.seedCurrentPolicy('2026-01-01');
    expect(await runForward()).toBe('');
    expect(await fx.historical()).toBeUndefined();
  });

  it('is re-runnable without stacking a duplicate row', async () => {
    await fx.seedCurrentPolicy();
    expect(await runForward()).toBe('');
    expect(await runForward()).toBe('');

    // A second row would overlap the first and make policy resolution
    // order-dependent.
    const rows = (await fx.policies()).filter((p) => p.name === HISTORICAL_NAME);
    expect(rows).toHaveLength(1);
  });

  it('takes an advisory lock so concurrent deploys cannot both insert', async () => {
    // run-pending-migrations.sh takes no DB lock and the deploy lock is
    // per-environment, so dev and prod can apply this file simultaneously
    // against the shared database. Hold the same advisory key from another
    // session and assert the migration blocks rather than racing ahead.
    await fx.seedCurrentPolicy();
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(484)');

      const raced = fx.attempt(FORWARD);
      const settled = await Promise.race([
        raced.then(() => 'completed'),
        new Promise<string>((r) => setTimeout(() => r('blocked'), 1500)),
      ]);
      expect(settled).toBe('blocked');

      await blocker.query('ROLLBACK');
      expect(await raced).toBe(''); // proceeds once the lock is released
    } finally {
      blocker.release();
    }
    expect((await fx.policies()).filter((p) => p.name === HISTORICAL_NAME)).toHaveLength(1);
  });

  describe('preflight', () => {
    it('blocks when no policy exists to sit before', async () => {
      const message = await runForward();
      expect(message).toContain('Migration 484 preflight');
      expect(message).toContain('empty');
      expect(await fx.policies()).toHaveLength(0);
    });

    it('blocks when attendance data starts before the assumed era boundary', async () => {
      await fx.seedCurrentPolicy();
      await fx.addEntry('2026-04-01'); // earlier than era_start

      const message = await runForward();
      expect(message).toContain('Migration 484 preflight');
      expect(message).toContain('2026-04-01');
      expect(await fx.historical()).toBeUndefined();
    });

    it('proceeds when attendance data starts on or after the era boundary', async () => {
      await fx.seedCurrentPolicy();
      await fx.addEntry(ERA_START);
      await fx.addEntry('2026-06-01');

      expect(await runForward()).toBe('');
      expect(await fx.historical()).toBeDefined();
    });

    it('proceeds when there is no attendance data at all', async () => {
      await fx.seedCurrentPolicy();
      expect(await runForward()).toBe('');
      expect(await fx.historical()).toBeDefined();
    });

    it('still checks the boundary when the era is already covered', async () => {
      // The boundary check runs before the insert branch, so a re-application
      // over an already-covered era can fail where it previously could not.
      // That is deliberate: earlier data means the boundary is stale and those
      // days are unprojectable regardless of whether this migration already ran.
      await fx.seedCurrentPolicy(ERA_START);
      await fx.addEntry('2026-04-01');

      const message = await runForward();
      expect(message).toContain('Migration 484 preflight');
      expect(message).toContain('2026-04-01');
    });

    it('blocks when the default overtime rule is ambiguous', async () => {
      await fx.seedCurrentPolicy();
      await fx.scoped(`INSERT INTO attendance_overtime_rules (is_default) VALUES (true)`);

      const message = await runForward();
      expect(message).toContain('exactly one default overtime rule');
      expect(await fx.historical()).toBeUndefined();
    });

    it('blocks when no rule is marked default', async () => {
      await fx.seedCurrentPolicy();
      await fx.scoped(`UPDATE attendance_overtime_rules SET is_default = false`);

      const message = await runForward();
      expect(message).toContain('exactly one default overtime rule');
      expect(await fx.historical()).toBeUndefined();
    });
  });

  describe('post-conditions', () => {
    it('blocks on an interior gap instead of silently no-opping over it', async () => {
      // A row starting at era_start satisfies "the era start is covered", but a
      // gap after it still leaves those days unprojectable — the exact defect
      // this migration exists to remove.
      await fx.seedPolicy('early', ERA_START, '2026-05-31');
      await fx.seedCurrentPolicy(); // 2026-08-03, leaving June-July uncovered

      const message = await runForward();
      expect(message).toContain('Migration 484 post-condition');
      expect(message).toContain('covered by no schedule policy');
    });

    it('blocks when existing policies already overlap', async () => {
      await fx.seedPolicy('early', ERA_START, CUTOVER); // overlaps the open policy
      await fx.seedCurrentPolicy();

      const message = await runForward();
      expect(message).toContain('Migration 484 post-condition');
      expect(message).toContain('overlap');
    });

    it('blocks when all coverage ends before the era starts', async () => {
      // Degenerate shape: every policy starts AND ends before era_start. The
      // insert branch is skipped (earliest_active_from <= era_start), and the
      // gap range would be era_start..(something earlier) — generate_series
      // returns zero rows when start > stop, so without the GREATEST clamp this
      // reports zero uncovered days while the entire era is uncovered.
      await fx.seedPolicy('ancient', '2026-01-01', '2026-02-01');

      const message = await runForward();
      expect(message).toContain('Migration 484 post-condition');
      expect(message).toContain('covered by no schedule policy');
    });

    it('passes cleanly on the production shape', async () => {
      await fx.seedCurrentPolicy();
      expect(await runForward()).toBe('');
      expect(await fx.policies()).toHaveLength(2);
    });
  });
});
