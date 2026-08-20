/**
 * batchWarning — a nudge, never a block.
 *
 * Ten units is a normal day. More than ten is usually a double-scan, but a
 * crew kit-out is legitimate, so the storeman can always proceed.
 */
import { describe, it, expect } from 'vitest';
import { batchWarning, SOFT_BATCH_WARN_AT } from '../batchWarning';

describe('batchWarning', () => {
  it('stays quiet at or below the threshold', () => {
    expect(batchWarning(0)).toBeNull();
    expect(batchWarning(1)).toBeNull();
    expect(batchWarning(SOFT_BATCH_WARN_AT)).toBeNull();
  });

  it('warns above the threshold, naming the count', () => {
    expect(batchWarning(11)).toBe(
      "That's 11 units in one issue — more than the usual 10. Double-scanned?",
    );
  });

  it('keeps warning as the count climbs', () => {
    expect(batchWarning(25)).toContain('25 units');
  });
});
