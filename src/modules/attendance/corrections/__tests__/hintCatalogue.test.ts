/**
 * Catalogue shape + coverage tests.
 *
 * Keeps the invariant: every AdjustmentKind has a hint; minimums are
 * above the absolute floor; placeholders are non-empty. Future kinds
 * added to the enum must come with a catalogue entry — the exhaustive
 * keys check fails loud otherwise.
 */

import { describe, it, expect } from 'vitest';
import {
  ADJUSTMENT_HINTS,
  ABSOLUTE_MIN_REASON_CHARS,
  getHint,
} from '../hintCatalogue';

const ALL_KINDS = [
  'forgot_clock_out',
  'wrong_clock_in_time',
  'wrong_clock_out_time',
  'wrong_site',
  'duplicate_entry',
  'other',
] as const;

describe('ADJUSTMENT_HINTS', () => {
  it('has an entry for every AdjustmentKind', () => {
    expect(Object.keys(ADJUSTMENT_HINTS).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('every entry has non-empty label, placeholder, and hint', () => {
    for (const kind of ALL_KINDS) {
      const h = ADJUSTMENT_HINTS[kind];
      expect(h.label.length).toBeGreaterThan(0);
      expect(h.placeholder.length).toBeGreaterThan(0);
      expect(h.hint.length).toBeGreaterThan(0);
    }
  });

  it('every minReasonChars respects the absolute floor', () => {
    for (const kind of ALL_KINDS) {
      expect(ADJUSTMENT_HINTS[kind].minReasonChars).toBeGreaterThanOrEqual(
        ABSOLUTE_MIN_REASON_CHARS
      );
    }
  });

  it('kinds that require more context set a higher minimum than simple ones', () => {
    // Deliberate: `duplicate_entry` / `other` / `wrong_site` need more
    // context than a straightforward `forgot_clock_out`. Reviewers rely
    // on this to avoid DM'ing the staff for details.
    expect(ADJUSTMENT_HINTS.duplicate_entry.minReasonChars).toBeGreaterThan(
      ADJUSTMENT_HINTS.forgot_clock_out.minReasonChars
    );
    expect(ADJUSTMENT_HINTS.other.minReasonChars).toBeGreaterThan(
      ADJUSTMENT_HINTS.forgot_clock_out.minReasonChars
    );
    expect(ADJUSTMENT_HINTS.wrong_site.minReasonChars).toBeGreaterThan(
      ADJUSTMENT_HINTS.forgot_clock_out.minReasonChars
    );
  });
});

describe('getHint', () => {
  it('returns the entry for a valid kind', () => {
    const h = getHint('forgot_clock_out');
    expect(h).not.toBeNull();
    expect(h?.label).toBe('Forgot to clock out');
  });

  it('returns null for unknown strings (UI-safe)', () => {
    expect(getHint('bogus')).toBeNull();
    expect(getHint('')).toBeNull();
    expect(getHint('FORGOT_CLOCK_OUT')).toBeNull(); // case-sensitive
  });

  it('does not accidentally match Object.prototype keys', () => {
    // Regression guard: without hasOwnProperty, `getHint('toString')`
    // would return the native toString function. We use hasOwnProperty
    // to reject prototype walks.
    expect(getHint('toString')).toBeNull();
    expect(getHint('constructor')).toBeNull();
    expect(getHint('hasOwnProperty')).toBeNull();
  });
});
