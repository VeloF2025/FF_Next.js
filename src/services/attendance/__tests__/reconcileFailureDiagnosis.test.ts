import { describe, expect, it } from 'vitest';

import { buildFailureDiagnosis } from '../reconcileFailureDiagnosis';

const KEY_A = 'aaaaaaaa-0000-4000-8000-000000000001:2026-08-11';
const KEY_B = 'bbbbbbbb-0000-4000-8000-000000000002:2026-08-12';

describe('buildFailureDiagnosis (#2480)', () => {
  it('returns null for a clean run so the row keeps a NULL error_message', () => {
    expect(buildFailureDiagnosis([], new Map(), new Set())).toBeNull();
  });

  it('pairs each failed day with its reason, in failedDayKeys order', () => {
    const failed = new Map([[KEY_B, 'day projection failed: boom'], [KEY_A, 'system closure failed: bang']]);

    const message = buildFailureDiagnosis([KEY_A, KEY_B], failed, new Set());

    expect(message).toBe(
      `${KEY_A}: system closure failed: bang\n${KEY_B}: day projection failed: boom`,
    );
  });

  it('labels a system-closed day that has no thrown error to quote', () => {
    const message = buildFailureDiagnosis([KEY_A], new Map(), new Set([KEY_A]));

    expect(message).toBe(`${KEY_A}: system-closed but not projected`);
  });

  it('never leaves a failed day key without a reason', () => {
    // A key present in neither collection must still get a line — a key with no
    // line is the exact "which day failed but not why" gap this module exists
    // to close.
    const message = buildFailureDiagnosis([KEY_A], new Map(), new Set());

    expect(message).toBe(`${KEY_A}: unknown failure`);
  });

  describe('truncation', () => {
    const manyKeys = Array.from({ length: 200 }, (_, i) =>
      `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}:2026-08-11`);
    const manyFailed = new Map(manyKeys.map((k) => [k, 'day projection failed: violates check constraint']));

    it('stays within the persisted-message budget', () => {
      const message = buildFailureDiagnosis(manyKeys, manyFailed, new Set())!;

      expect(message.length).toBeLessThanOrEqual(2_000);
    });

    it('drops whole lines and says how many, rather than cutting mid-reason', () => {
      const message = buildFailureDiagnosis(manyKeys, manyFailed, new Set())!;
      const [body, marker] = [message.slice(0, message.lastIndexOf('\n')), message.slice(message.lastIndexOf('\n') + 1)];

      expect(marker).toMatch(/^… \d+ more day\(s\) omitted$/);
      // Every retained line is intact: key, separator, and the full reason.
      for (const line of body.split('\n')) {
        expect(line).toMatch(/^cccccccc-[0-9a-f-]+:2026-08-11: day projection failed: violates check constraint$/);
      }
    });

    it('accounts for every day exactly once between kept lines and the omitted count', () => {
      const message = buildFailureDiagnosis(manyKeys, manyFailed, new Set())!;
      const lines = message.split('\n');
      const omitted = Number(/… (\d+) more/.exec(lines.at(-1)!)![1]);

      expect(lines.length - 1 + omitted).toBe(manyKeys.length);
    });

    it('still emits the first line when that line alone exceeds the budget', () => {
      const hugeReason = 'x'.repeat(5_000);
      const message = buildFailureDiagnosis([KEY_A], new Map([[KEY_A, hugeReason]]), new Set())!;

      expect(message.length).toBe(2_000);
      expect(message.startsWith(`${KEY_A}: xxx`)).toBe(true);
    });
  });
});
