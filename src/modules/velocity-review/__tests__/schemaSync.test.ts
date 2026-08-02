import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const sql = (filename: string): string =>
  readFileSync(join(process.cwd(), 'scripts/migrations/sql', filename), 'utf8');

describe('Velocity review migration SQL contract', () => {
  it('keeps durable export states, controls, and uniqueness in sync', () => {
    const forward = sql('478_velocity_review_export.sql');

    expect(forward).toContain("'onemap_home_signup'");
    expect(forward).toContain("'onemap_install_signature'");
    expect(forward).toMatch(/UNIQUE \(dr_number, phone_e164\)/);
    expect(
      forward.match(
        /CHECK \(dr_number <> '' AND dr_number = UPPER\(BTRIM\(dr_number\)\)\)/g
      ) ?? []
    ).toHaveLength(2);
    expect(forward).toMatch(/'retryable_failure'.*'ambiguous'.*'ack_cleanup_pending'/s);
    expect(forward).toContain('automation_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    expect(forward).toContain('go_live_date DATE');
    expect(forward).toContain('pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    expect(forward).toContain('pilot_target_date DATE');
    expect(forward).toContain('pilot_limit INTEGER');
    expect(forward).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_velocity_review_one_phone_inflight');
    expect(forward).not.toMatch(/^\s*BEGIN;\s*$/m);
  });

  it('keeps preflight read-only and rollback consent-preserving', () => {
    const preflight = sql('preflight_478_velocity_review_export.sql');
    const rollback = sql('rollback_478_velocity_review_export.sql');

    expect(preflight).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
    expect(preflight).toMatch(
      /SELECT target_date, UPPER\(BTRIM\(dr_number\)\) AS dr_number, COUNT\(\*\).*GROUP BY target_date, UPPER\(BTRIM\(dr_number\)\)/s
    );
    expect(preflight).toMatch(
      /SELECT dr_number, SUM\(pair_count\) AS duplicate_row_count.*GROUP BY UPPER\(BTRIM\(dr_number\)\), phone_e164/s
    );
    // The rollback must NOT collapse the two OneMap evidence sources back to
    // 'import'. That is POPIA evidence of which consent event was captured, on a
    // table shared with the WhatsApp stack, and the rewrite is irreversible.
    expect(rollback).not.toContain("SET source = 'import'");
    // Nor may it narrow migration 469's CHECK back — that is what forced the
    // rewrite. Widening a vocabulary is additive; pre-478 writers still satisfy it.
    expect(rollback).not.toMatch(/ADD CONSTRAINT wa_subscriber_consent_source_chk/);

    // The permanent contact ledger must survive rollback. Dropping it and
    // re-applying would make every already-contacted customer eligible again.
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS velocity_review_exports/);
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS velocity_review_runs/);
    // But the control row must go, so a re-apply comes back disabled-by-default
    // rather than resuming whatever an operator last enabled.
    expect(rollback).toMatch(/DROP TABLE IF EXISTS velocity_review_control/);

    expect(rollback).not.toMatch(/^\s*(BEGIN|COMMIT);\s*$/gim);
  });
});
