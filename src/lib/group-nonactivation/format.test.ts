import { describe, it, expect } from 'vitest';
import {
  isCanonicalDr,
  dayDiffIso,
  addDaysIso,
  ppProjectFor,
  RESIDUAL_LABEL,
  OLT_ISSUE_LABEL,
  OLT_OPEN_STATES,
  oltIssueLabel,
  oltNoteFor,
  type ResidualClass,
} from './format';

describe('group-nonactivation/format', () => {
  describe('isCanonicalDr', () => {
    it('accepts a canonical 7-digit DR', () => {
      expect(isCanonicalDr('DR1857119')).toBe(true);
    });
    it('rejects typo / placeholder / out-of-shape DR values', () => {
      expect(isCanonicalDr('DR185729')).toBe(false); // 6 digits
      expect(isCanonicalDr('DR12345678')).toBe(false); // 8 digits
      expect(isCanonicalDr('DR NEEDED')).toBe(false);
      expect(isCanonicalDr('ACTIVATION NEEDED')).toBe(false);
      expect(isCanonicalDr('dr1857119')).toBe(false); // lowercase prefix
    });
  });

  describe('dayDiffIso', () => {
    it('returns whole-day difference, tz-independent', () => {
      expect(dayDiffIso('2026-06-25', '2026-06-26')).toBe(1);
      expect(dayDiffIso('2026-06-11', '2026-06-26')).toBe(15);
      expect(dayDiffIso('2026-06-26', '2026-06-26')).toBe(0);
    });
    it('handles month boundaries and negative (from > to)', () => {
      expect(dayDiffIso('2026-05-31', '2026-06-01')).toBe(1);
      expect(dayDiffIso('2026-06-26', '2026-06-25')).toBe(-1);
    });
  });

  describe('addDaysIso', () => {
    it('shifts a date backward', () => {
      expect(addDaysIso('2026-06-25', -1)).toBe('2026-06-24');
      expect(addDaysIso('2026-06-25', -14)).toBe('2026-06-11');
      expect(addDaysIso('2026-06-01', -1)).toBe('2026-05-31');
    });
    it('shifts a date forward across a month boundary', () => {
      expect(addDaysIso('2026-06-01', 30)).toBe('2026-07-01');
    });
  });

  describe('ppProjectFor', () => {
    it('maps Thembisa names to TEM codes', () => {
      expect(ppProjectFor('Thembisa POP 1')).toBe('TEM');
      expect(ppProjectFor('Thembisa POP 3')).toBe('TEM-3');
    });
    it('passes through identical project names', () => {
      expect(ppProjectFor('Lawley')).toBe('Lawley');
      expect(ppProjectFor('Mohadin')).toBe('Mohadin');
    });
    it('returns empty string for null/empty', () => {
      expect(ppProjectFor(null)).toBe('');
      expect(ppProjectFor('')).toBe('');
    });
  });

  describe('RESIDUAL_LABEL', () => {
    it('has a human label for every residual class', () => {
      const classes: ResidualClass[] = [
        'resolved',
        'resolvable',
        'placeholder',
        'in_stock_no_install',
        'unknown',
      ];
      for (const c of classes) {
        expect(RESIDUAL_LABEL[c]).toBeTruthy();
      }
    });
  });

  describe('oltNoteFor', () => {
    it('maps absent-from-1Map states to Note 2 (no field-app entry)', () => {
      expect(oltNoteFor('not_found')).toBe('note2');
      expect(oltNoteFor('serial_other_dr')).toBe('note2');
    });
    it('maps wrong-serial states to Note 4 (drop#/serial mismatch)', () => {
      expect(oltNoteFor('pending')).toBe('note4');
      expect(oltNoteFor('needs_investigation')).toBe('note4');
      expect(oltNoteFor('needs_reinvestigation')).toBe('note4');
      expect(oltNoteFor('empty_serial')).toBe('note4');
    });
    it('classifies every open state (note2 + note4 partition the set)', () => {
      const note2 = OLT_OPEN_STATES.filter((s) => oltNoteFor(s) === 'note2');
      const note4 = OLT_OPEN_STATES.filter((s) => oltNoteFor(s) === 'note4');
      expect(note2.length + note4.length).toBe(OLT_OPEN_STATES.length);
    });
  });

  describe('OLT_ISSUE_LABEL', () => {
    it('has a label for every open state', () => {
      for (const s of OLT_OPEN_STATES) {
        expect(OLT_ISSUE_LABEL[s]).toBeTruthy();
      }
    });
    it('reuses the Investigate tab sub-filter wording so rows are findable in the UI', () => {
      expect(OLT_ISSUE_LABEL.not_found).toBe('Not on 1Map');
      expect(OLT_ISSUE_LABEL.serial_other_dr).toBe('Serial on Other DR');
      expect(OLT_ISSUE_LABEL.needs_investigation).toBe('Cross-DR Conflict');
    });
  });

  describe('oltIssueLabel', () => {
    it('calls a pending row with an OES serial Fixable — it is on the Fixable tab', () => {
      expect(oltIssueLabel('pending', true)).toBe('Fixable — serial mismatch');
    });
    it('does NOT call a pending row without an OES serial Fixable — the UI routes it to Investigate', () => {
      expect(oltIssueLabel('pending', false)).toBe('Other');
      expect(oltIssueLabel('pending', false)).not.toBe(OLT_ISSUE_LABEL.pending);
    });
    it('ignores the serial flag for every non-pending state', () => {
      for (const s of OLT_OPEN_STATES.filter((x) => x !== 'pending')) {
        expect(oltIssueLabel(s, true)).toBe(OLT_ISSUE_LABEL[s]);
        expect(oltIssueLabel(s, false)).toBe(OLT_ISSUE_LABEL[s]);
      }
    });
  });
});
