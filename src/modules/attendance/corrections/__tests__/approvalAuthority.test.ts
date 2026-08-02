import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as correctionQueries from '../queries';
import { transitionAdjustmentStatus } from '../adjustmentMutations';

describe('correction approval authority', () => {
  it('does not expose the unguarded approval mutation from the query barrel', () => {
    expect(correctionQueries).not.toHaveProperty('applyApprovedAdjustmentTxn');
    const barrel = readFileSync(
      resolve(process.cwd(), 'src/modules/attendance/corrections/queries.ts'),
      'utf8'
    );
    expect(barrel).not.toContain('applyApprovedAdjustmentTxn');
  });

  it('does not permit approved through the generic public transition', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/modules/attendance/corrections/adjustmentMutations.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/newStatus\s*:\s*[^;\n]*approved/i);
    expectTypeOf<Parameters<typeof transitionAdjustmentStatus>[0]['newStatus']>().toEqualTypeOf<
      'rejected' | 'cancelled'
    >();
  });

  it('routes every production approval caller through guardedApproval', () => {
    for (const path of [
      'pages/api/staff/attendance-corrections-review.ts',
      'pages/api/field/attendance-adjust.ts',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source).not.toMatch(
        /import\s*\{[^}]*applyApprovedAdjustmentTxn[^}]*\}\s*from\s*['"][^'"]*corrections\/queries['"]/s
      );
      expect(source).toMatch(/corrections\/guardedApproval/);
    }
  });

  it('does not direct field correction work to the old approval authority', () => {
    for (const path of [
      'docs/superpowers/plans/2026-06-24-field-workers-admin.md',
      'docs/superpowers/specs/2026-06-24-field-workers-admin-design.md',
    ]) {
      expect(readFileSync(resolve(process.cwd(), path), 'utf8')).not.toContain(
        'applyApprovedAdjustmentTxn'
      );
    }
  });
});
