import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const forward = readFileSync('scripts/migrations/sql/476_attendance_lock_hr_authority.sql', 'utf8');
const rollback = readFileSync('scripts/migrations/sql/rollback_476_attendance_lock_hr_authority.sql', 'utf8');

describe('attendance lock HR authority migration', () => {
  it('removes manager create/edit while preserving admin authority', () => {
    expect(forward).toMatch(/'manager'\s*,\s*'people\.staff\.attendance\.locks'[\s\S]*?"create":false[\s\S]*?"edit":false/);
    expect(forward).toMatch(/'admin'\s*,\s*'people\.staff\.attendance\.locks'[\s\S]*?"create":true[\s\S]*?"edit":true/);
    expect(forward).toMatch(/'super_admin'\s*,\s*'people\.staff\.attendance\.locks'[\s\S]*?"create":true[\s\S]*?"edit":true/);
    expect(forward).toMatch(/ON CONFLICT \(role, permission_key\) DO UPDATE/i);
  });

  it('keeps bulk-lock authority admin-only', () => {
    expect(forward).toMatch(/'manager'\s*,\s*'people\.staff\.attendance\.bulk_lock'[\s\S]*?"create":false/);
    expect(forward).toMatch(/'admin'\s*,\s*'people\.staff\.attendance\.bulk_lock'[\s\S]*?"create":true/);
  });

  it('documents and restores the legacy manager grant on rollback', () => {
    expect(rollback).toMatch(/'manager'\s*,\s*'people\.staff\.attendance\.locks'[\s\S]*?"create":true[\s\S]*?"edit":true/);
    expect(rollback).toMatch(/ON CONFLICT \(role, permission_key\) DO UPDATE/i);
  });
});
