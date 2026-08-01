import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const sql = (filename: string): string =>
  readFileSync(join(process.cwd(), 'scripts/migrations/sql', filename), 'utf8');

describe('Velocity review migration SQL contract', () => {
  it('keeps durable export states, controls, and uniqueness in sync', () => {
    const forward = sql('472_velocity_review_export.sql');

    expect(forward).toContain("'onemap_home_signup'");
    expect(forward).toContain("'onemap_install_signature'");
    expect(forward).toMatch(/UNIQUE \(dr_number, phone_fingerprint\)/);
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
    const preflight = sql('preflight_472_velocity_review_export.sql');
    const rollback = sql('rollback_472_velocity_review_export.sql');

    expect(preflight).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
    expect(rollback).toContain("SET source = 'import'");
  });
});
