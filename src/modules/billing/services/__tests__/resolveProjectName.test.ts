import { describe, it, expect } from 'vitest';
import {
  resolveProjectNameAgainst,
  type BillableProject,
} from '../resolveProjectName';

const PROJECTS: BillableProject[] = [
  { id: '1', name: 'Lawley' },
  { id: '2', name: 'Mamelodi' },
  { id: '3', name: 'Mohadin' },
  { id: '4', name: 'Thembisa POP 1' },
  { id: '5', name: 'Thembisa POP 2' },
  { id: '6', name: 'Thembisa POP 3' },
];

describe('resolveProjectNameAgainst', () => {
  describe('real-world FiberTime filenames (WE260405 batch)', () => {
    it('resolves "Lawley" exactly', () => {
      const r = resolveProjectNameAgainst('Lawley', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Lawley');
    });

    it('resolves "Mamelodi" exactly', () => {
      const r = resolveProjectNameAgainst('Mamelodi', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Mamelodi');
    });

    it('resolves "Mohadin" exactly', () => {
      const r = resolveProjectNameAgainst('Mohadin', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Mohadin');
    });

    it('resolves "Tembisa POP01" to "Thembisa POP 1" (real filename variant)', () => {
      const r = resolveProjectNameAgainst('Tembisa POP01', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 1');
    });

    it('resolves "Thembisa POP 1" exactly', () => {
      const r = resolveProjectNameAgainst('Thembisa POP 1', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 1');
    });
  });

  describe('normalization', () => {
    it('handles stuck-together letter/digit ("POP01" → [pop, 1])', () => {
      const r = resolveProjectNameAgainst('Tembisa POP01', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 1');
    });

    it('strips leading zeros ("POP 02" → pop 2)', () => {
      const r = resolveProjectNameAgainst('Thembisa POP 02', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 2');
    });

    it('maps word-form digits ("Thembisa POP One" → pop 1)', () => {
      const r = resolveProjectNameAgainst('Thembisa POP One', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 1');
    });

    it('is case-insensitive and punctuation-insensitive', () => {
      const r = resolveProjectNameAgainst('thembisa-pop-1', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 1');
    });
  });

  describe('fuzzy fallback', () => {
    it('tolerates single-char spelling variants (Tembisa ↔ Thembisa)', () => {
      const r = resolveProjectNameAgainst('Tembisa POP 1', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 1');
    });

    it('still distinguishes same-prefix POP numbers (1 vs 2)', () => {
      const r = resolveProjectNameAgainst('Tembisa POP 2', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 2');
    });

    it('does NOT fuzzy-match unrelated project names', () => {
      const r = resolveProjectNameAgainst('Randomville', PROJECTS);
      expect(r.matched).toBe(false);
      expect(r.project).toBeNull();
    });
  });

  describe('ambiguity', () => {
    it('returns candidates when input is too generic', () => {
      const r = resolveProjectNameAgainst('Thembisa', PROJECTS);
      expect(r.matched).toBe(false);
      expect(r.candidates.length).toBe(3);
    });

    it('returns candidates when fuzzy matches multiple', () => {
      const r = resolveProjectNameAgainst('Tembisa POP', PROJECTS);
      expect(r.matched).toBe(false);
      expect(r.candidates.length).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('returns unmatched for empty input', () => {
      const r = resolveProjectNameAgainst('', PROJECTS);
      expect(r.matched).toBe(false);
    });

    it('returns unmatched when project list is empty', () => {
      const r = resolveProjectNameAgainst('Lawley', []);
      expect(r.matched).toBe(false);
    });
  });

  describe('POP-suffix fallback (single-project sites)', () => {
    // Etwatwa is one project — the FT report labels it "Etwatwa POP02", but
    // the FibreFlow project name has no POP code. The orphan pop/2 tokens
    // miss every direct pass; the fallback retries with "POP02" stripped.
    const WITH_ETWATWA: BillableProject[] = [...PROJECTS, { id: '7', name: 'Etwatwa' }];

    it('resolves "Etwatwa POP02" to "Etwatwa" (PDF Site / payment filename)', () => {
      const r = resolveProjectNameAgainst('Etwatwa POP02', WITH_ETWATWA);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Etwatwa');
      expect(r.rawInput).toBe('Etwatwa POP02');
    });

    it('resolves "ETW POP02" to "Etwatwa" (abbreviated notes filename)', () => {
      const r = resolveProjectNameAgainst('ETW POP02', WITH_ETWATWA);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Etwatwa');
    });

    it('still resolves "Etwatwa" plain exactly (fallback not needed)', () => {
      const r = resolveProjectNameAgainst('Etwatwa', WITH_ETWATWA);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Etwatwa');
    });

    it('does NOT collapse multi-POP sites: stripping POP leaves "Thembisa" ambiguous', () => {
      // No "Thembisa POP 9" exists; the direct pass misses and the fallback
      // strips to "Thembisa" → 3 candidates → not unique → stays unmatched
      // rather than wrongly picking one POP.
      const r = resolveProjectNameAgainst('Thembisa POP 9', WITH_ETWATWA);
      expect(r.matched).toBe(false);
      expect(r.project).toBeNull();
    });

    it('does not strip a leading/middle POP token (anchored to the end)', () => {
      // "POP" not followed by a trailing number stays put; unrelated input
      // remains unmatched.
      const r = resolveProjectNameAgainst('Randomville', WITH_ETWATWA);
      expect(r.matched).toBe(false);
    });
  });

  describe('abbreviation prefix', () => {
    it('resolves "TEM POP01" to "Thembisa POP 1" via prefix match', () => {
      const r = resolveProjectNameAgainst('TEM POP01', PROJECTS);
      expect(r.matched).toBe(true);
      expect(r.project?.name).toBe('Thembisa POP 1');
    });

    it('does not prefix-match 2-char tokens (too ambiguous)', () => {
      const twoProjects: BillableProject[] = [
        { id: '1', name: 'Lawley' },
        { id: '2', name: 'Laketown' },
      ];
      const r = resolveProjectNameAgainst('La', twoProjects);
      expect(r.matched).toBe(false);
    });
  });
});
