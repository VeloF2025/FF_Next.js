/**
 * Migration 471 (classified training certificates): SQL contract ratchet.
 *
 * Mirrors checkinSchemaSync / appointmentTypeSync / safetyLibraryTypeSync. The
 * assertions here are not "does the SQL parse" — they pin the handful of
 * clauses that carry a design decision which would otherwise live only in a
 * handler, where a row already written in a bad state can no longer be fixed:
 *
 *   lifecycle CHECK        — a training row is only ever one of four states.
 *   staff_documents CHECK  — 'revoked' is added WITHOUT dropping 'expired'.
 *   partial unique index   — one document links a training type at most once.
 *   super_admin-only grant — the seeded role grant is deliberately narrow;
 *                            custodians arrive as named user overrides.
 *   guarded backfill       — the one-time 'verified' backfill must never re-run
 *                            and flip genuinely-pending submissions.
 *   unwrapped forward      — scripts/run-pending-migrations.sh applies the file
 *                            with `psql -1` and appends the schema_migrations
 *                            INSERT as a second -c. A BEGIN;/COMMIT; inside the
 *                            file ends that transaction early, so the DDL can
 *                            commit while its tracker row fails independently.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = '471_hs_training_certificate_upload.sql';
const FORWARD_PATH = `scripts/migrations/sql/${MIGRATION}`;
const ROLLBACK_PATH = `scripts/migrations/sql/rollback_${MIGRATION}`;
const PREFLIGHT_PATH = `scripts/migrations/sql/preflight_${MIGRATION}`;

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('471 forward migration', () => {
  const forward = read(FORWARD_PATH);

  it('links a training row to the one stored certificate binary', () => {
    expect(forward).toContain('staff_document_id');
    expect(forward).toMatch(
      /staff_document_id uuid\s+REFERENCES staff_documents\(id\) ON DELETE RESTRICT/
    );
  });

  it('constrains the training lifecycle to the four designed states', () => {
    expect(forward).toContain(
      "verification_status IN ('pending', 'verified', 'rejected', 'revoked')"
    );
  });

  it("adds 'revoked' to staff_documents without dropping 'expired'", () => {
    expect(forward).toContain(
      "verification_status IN ('pending', 'verified', 'rejected', 'expired', 'revoked')"
    );
  });

  it('links each document to a given training type at most once', () => {
    expect(forward).toContain('WHERE staff_document_id IS NOT NULL');
    expect(forward).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?\(staff_document_id, training_type_id\)[\s\S]*?WHERE staff_document_id IS NOT NULL/
    );
  });

  it('indexes the gate read by its status-aware shape', () => {
    expect(forward).toMatch(/\(contractor_id, verification_status, expiry_date\)/);
  });

  it('enforces one live certificate number per employee and provider', () => {
    expect(forward).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?LOWER\(BTRIM\(document_number\)\)[\s\S]*?LOWER\(BTRIM\(issuing_authority\)\)/
    );
    // Blank numbers are not a collision, and a rejected/revoked submission must
    // not block re-upload of a corrected certificate.
    expect(forward).toMatch(
      /WHERE document_type = 'certification'[\s\S]*?verification_status IN \('pending', 'verified'\)[\s\S]*?NULLIF\(BTRIM\(document_number\), ''\) IS NOT NULL/
    );
  });

  it('registers the dedicated permission under people.staff', () => {
    expect(forward).toContain("'people.staff.training-certificates'");
    expect(forward).toMatch(/'people\.staff\.training-certificates', 'people\.staff'/);
  });

  it('grants the permission to super_admin only', () => {
    expect(forward).toContain("'super_admin'");
    // A generic admin grant would hand every admin the certificate binaries the
    // design deliberately withholds until a named override is chosen.
    expect(forward).not.toMatch(/'admin'\s*,\s*'people\.staff\.training-certificates'/);
    const grants = forward.match(/INSERT INTO role_permissions[\s\S]*?;/);
    expect(grants).not.toBeNull();
    expect(grants?.[0]).not.toMatch(/'(admin|manager|technician|viewer|contractor|storeman|client)'/);
  });

  it('seeds the four fibre competencies with no invented expiry', () => {
    expect(forward).toContain("'fibre_splicing'");
    expect(forward).toContain("'otdr_testing'");
    expect(forward).toContain("'blown_fibre_installation'");
    expect(forward).toContain("'aerial_fibre_installation'");
    const seed = forward.match(/INSERT INTO hs_training_types[\s\S]*?;/);
    expect(seed).not.toBeNull();
    for (const code of [
      'fibre_splicing',
      'otdr_testing',
      'blown_fibre_installation',
      'aerial_fibre_installation',
    ]) {
      expect(seed?.[0]).toMatch(new RegExp(`'${code}',[^\\n]*?NULL`));
    }
  });

  it('expires only pending and verified documents', () => {
    // The old body was `verification_status != 'expired'`, which would trample a
    // rejection or a revocation the moment the certificate's own date passed.
    expect(forward).toMatch(/CREATE OR REPLACE FUNCTION update_expired_documents/);
    expect(forward).toMatch(
      /UPDATE staff_documents[\s\S]*?verification_status IN \('pending', 'verified'\)/
    );
    expect(forward).not.toMatch(/AND verification_status != 'expired'/);
  });

  it('backfills legacy rows to verified exactly once', () => {
    // Re-running an unguarded `UPDATE ... SET verification_status = 'verified'`
    // would silently approve every pending submission in the table.
    expect(forward).toMatch(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint[\s\S]*?hs_worker_training_verification_status_chk[\s\S]*?UPDATE hs_worker_training[\s\S]*?SET verification_status = 'verified'/
    );
  });

  it('scopes the backfill guard to its own table', () => {
    // conname is unique per (table, name), not globally. Matching on the name
    // alone lets an unrelated table carrying the same constraint name skip both
    // the backfill AND the CHECK creation — the column is then unconstrained
    // and every legacy record stays 'pending', silently counting for nothing.
    expect(forward).toMatch(
      /conname = 'hs_worker_training_verification_status_chk'[\s\S]*?AND conrelid = 'hs_worker_training'::regclass/
    );
  });

  it('is not self-wrapped in a transaction', () => {
    expect(forward).not.toMatch(/^\s*BEGIN;\s*$/m);
    expect(forward).not.toMatch(/^\s*COMMIT;\s*$/m);
  });

  it('records itself in schema_migrations for a manual psql -f apply', () => {
    expect(forward).toMatch(
      new RegExp(`INSERT INTO schema_migrations[\\s\\S]*?'${MIGRATION}'[\\s\\S]*?ON CONFLICT`)
    );
  });
});

describe('471 preflight', () => {
  const preflight = read(PREFLIGHT_PATH);

  it('reports the conflicts that would make the unique index fail to build', () => {
    expect(preflight).toContain('duplicate_certification_count');
    expect(preflight).toContain('existing_training_count');
    expect(preflight).toContain('revoked_staff_document_count');
  });

  it('is read-only', () => {
    expect(preflight).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  });
});

describe('471 rollback', () => {
  const rollback = read(ROLLBACK_PATH);

  it('preserves revoked documents as rejected before the state disappears', () => {
    // 'revoked' stops existing when the CHECK is restored; dropping the rows
    // would erase the record that the evidence was withdrawn.
    expect(rollback).toContain("SET verification_status = 'rejected'");
  });

  it('removes every column it added', () => {
    expect(rollback).toContain('DROP COLUMN IF EXISTS staff_document_id');
    for (const col of [
      'verification_status',
      'verified_by',
      'verified_at',
      'rejection_reason',
      'revoked_by',
      'revoked_at',
      'revocation_reason',
    ]) {
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${col}`);
    }
  });

  it('restores the original staff-document status vocabulary', () => {
    expect(rollback).toContain("verification_status IN ('pending', 'verified', 'rejected', 'expired')");
    expect(rollback).toMatch(/CREATE OR REPLACE FUNCTION update_expired_documents/);
  });

  it('only deletes seeded training types nothing references', () => {
    expect(rollback).toMatch(
      /DELETE FROM hs_training_types[\s\S]*?NOT EXISTS \(\s*SELECT 1 FROM hs_worker_training/
    );
  });

  it('removes the permission grants that nothing cascades for', () => {
    // No foreign key references access_permissions, so role_permissions and
    // user_permission_overrides are NOT cleaned up automatically. An orphaned
    // override does not merely linger: with its access_permissions row gone the
    // RBAC ancestor chain has nothing to walk, so the fail-closed people /
    // people.staff check is skipped while the override still outranks the role
    // table. rollback_470 deletes them for the same reason.
    expect(rollback).toMatch(
      /DELETE FROM user_permission_overrides\s*\n\s*WHERE permission_key = 'people\.staff\.training-certificates'/
    );
    expect(rollback).toMatch(
      /DELETE FROM role_permissions\s*\n\s*WHERE permission_key = 'people\.staff\.training-certificates'/
    );
    // Order matters: dependents before the row they hang off.
    expect(rollback.indexOf('DELETE FROM user_permission_overrides')).toBeLessThan(
      rollback.indexOf('DELETE FROM access_permissions')
    );
  });

  it('warns that a round trip approves what it forgot', () => {
    // Re-applying after a rollback re-runs the one-time backfill against rows
    // whose decisions were dropped, promoting unchecked evidence to 'verified'.
    expect(rollback).toMatch(/ROUND TRIP[\s\S]*?SILENTLY APPROVES/);
  });

  it('clears its own tracker row', () => {
    expect(rollback).toContain(`DELETE FROM schema_migrations WHERE filename = '${MIGRATION}'`);
  });

  it('rescues revoked rows before restoring the constraint that forbids them', () => {
    const preserveAt = rollback.indexOf("SET verification_status = 'rejected'");
    const restoreAt = rollback.indexOf(
      "verification_status IN ('pending', 'verified', 'rejected', 'expired')"
    );
    expect(preserveAt).toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(-1);
    expect(preserveAt).toBeLessThan(restoreAt);
  });

  it('guards its DDL so a second run is a no-op', () => {
    for (const idx of [
      'ux_hs_worker_training_document_type',
      'idx_hs_worker_training_gate',
      'ux_staff_documents_certification_number',
    ]) {
      expect(rollback).toContain(`DROP INDEX IF EXISTS ${idx}`);
    }
    expect(rollback).toContain(
      'DROP CONSTRAINT IF EXISTS hs_worker_training_verification_status_chk'
    );
  });
});
