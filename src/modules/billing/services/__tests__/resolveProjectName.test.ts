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
});
