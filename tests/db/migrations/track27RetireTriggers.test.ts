/**
 * tests/db/migrations/track27RetireTriggers.test.ts
 *
 * Sprint E Track 2.7 + Track 7 — verify that mig 387 (with the DROP block)
 * leaves the trigger + function set in exactly the expected post-cutover state.
 *
 * Assertions:
 *   ABSENT (dropped in mig 387):
 *     - emit_serial_event_on_picking_done       (mig 364 T1 / mig 366 fix)
 *     - emit_serial_event_on_oes_activate       (mig 364 T3 / mig 365 fix)
 *     - emit_serial_event_on_drop_install       (mig 367)
 *     - emit_serial_event_on_return             (mig 364 T4)   — Track 7
 *     - emit_serial_event_on_return_line_insert (mig 364 T4b)  — Track 7
 *     - trg_emit_serial_event_on_picking_done()
 *     - trg_emit_serial_event_on_oes_activate()
 *     - trg_emit_serial_event_on_drop_install()
 *     - trg_emit_serial_event_on_return()             — Track 7
 *     - trg_emit_serial_event_on_return_line_insert() — Track 7
 *
 *   Track 7 retires the two return-creation triggers because return creation
 *   now routes through promoteSerial('returned') (returns/index.ts).
 *
 *   PRESENT (retained — not superseded):
 *     - emit_serial_event_on_qa_install    (mig 364 T2 / mig 365 fix)
 *
 *   PRESENT (mig 387 generic set — installed by the same transaction):
 *     - trg_stock_serial_status_validate_t
 *     - trg_stock_serial_status_emit_t
 *     - trg_stock_serial_holder_validate_t
 *
 * Requires: Sprint E container (mig 387 applied via vitest.db.sprinte.config.ts).
 * Config:   vitest.db.sprinte.config.ts
 */

import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  throw new Error('TEST_DATABASE_URL not set — run via vitest.db.sprinte.config.ts');
}

// ─── Retired triggers (dropped by Track 2.7 + Track 7) ───────────────────────
const RETIRED_TRIGGERS = [
  'emit_serial_event_on_picking_done',
  'emit_serial_event_on_oes_activate',
  'emit_serial_event_on_drop_install',
  'emit_serial_event_on_return',             // Track 7 — routed via promoteSerial
  'emit_serial_event_on_return_line_insert', // Track 7 — routed via promoteSerial
] as const;

// ─── Retired functions (dropped by Track 2.7 + Track 7) ──────────────────────
const RETIRED_FUNCTIONS = [
  'trg_emit_serial_event_on_picking_done',
  'trg_emit_serial_event_on_oes_activate',
  'trg_emit_serial_event_on_drop_install',
  'trg_emit_serial_event_on_return',             // Track 7
  'trg_emit_serial_event_on_return_line_insert', // Track 7
] as const;

// ─── Retained legacy triggers (NOT dropped) ──────────────────────────────────
const RETAINED_TRIGGERS = [
  'emit_serial_event_on_qa_install',
] as const;

// ─── mig 387 generic triggers (must be present post-cutover) ─────────────────
const GENERIC_387_TRIGGERS = [
  'trg_stock_serial_status_validate_t',
  'trg_stock_serial_status_emit_t',
  'trg_stock_serial_holder_validate_t',
] as const;

describe('Track 2.7: mig 387 trigger retirement assertions (Sprint E container)', () => {
  it('retired triggers are absent from pg_trigger', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`,
      );
      const installedNames = rows.map(r => r.tgname);

      for (const name of RETIRED_TRIGGERS) {
        expect(
          installedNames,
          `Legacy trigger "${name}" must be absent after mig 387 Track 2.7 DROP`,
        ).not.toContain(name);
      }
    } finally {
      await pool.end();
    }
  });

  it('retained legacy triggers are still present in pg_trigger', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`,
      );
      const installedNames = rows.map(r => r.tgname);

      for (const name of RETAINED_TRIGGERS) {
        expect(
          installedNames,
          `Retained trigger "${name}" must still be present (not retired in Track 2.7)`,
        ).toContain(name);
      }
    } finally {
      await pool.end();
    }
  });

  it('mig 387 generic triggers are present in pg_trigger', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`,
      );
      const installedNames = rows.map(r => r.tgname);

      for (const name of GENERIC_387_TRIGGERS) {
        expect(
          installedNames,
          `mig 387 generic trigger "${name}" must be present`,
        ).toContain(name);
      }
    } finally {
      await pool.end();
    }
  });

  it('retired trigger functions are absent from pg_proc', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const { rows } = await pool.query<{ proname: string }>(
        `SELECT proname FROM pg_proc
          WHERE proname LIKE 'trg_emit_serial_event%'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`,
      );
      const installedFunctions = rows.map(r => r.proname);

      for (const name of RETIRED_FUNCTIONS) {
        expect(
          installedFunctions,
          `Legacy function "${name}()" must be absent after mig 387 Track 2.7 DROP`,
        ).not.toContain(name);
      }
    } finally {
      await pool.end();
    }
  });

  it('retained trigger functions are still present in pg_proc', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const { rows } = await pool.query<{ proname: string }>(
        `SELECT proname FROM pg_proc
          WHERE proname LIKE 'trg_emit_serial_event%'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`,
      );
      const installedFunctions = rows.map(r => r.proname);

      // Function backing the retained qa_install trigger.
      expect(
        installedFunctions,
        'trg_emit_serial_event_on_qa_install() must still exist',
      ).toContain('trg_emit_serial_event_on_qa_install');
    } finally {
      await pool.end();
    }
  });
});
