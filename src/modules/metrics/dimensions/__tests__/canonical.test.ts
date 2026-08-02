import { describe, it, expect } from 'vitest';
import { canonicalProject, UNKNOWN_PROJECT, PROJECT_ALIASES } from '../canonical';

/**
 * Every alias here was resolved empirically by joining the free-text value through
 * drops -> projects, not guessed from its shape. See canonical.ts for the query.
 */
describe('canonicalProject', () => {
  it('maps TEM and TEM-3 to DIFFERENT projects', () => {
    // The trap: they look like a base name and a variant of it, so the obvious
    // reading is "fold TEM-3 into TEM". They are two separate POPs — 157 of 170
    // TEM rows resolve to Thembisa POP 1, and all 42 TEM-3 rows to Thembisa POP 3.
    // Folding them would merge two distinct sites into one number.
    expect(canonicalProject('TEM')).toBe('Thembisa POP 1');
    expect(canonicalProject('TEM-3')).toBe('Thembisa POP 3');
    expect(canonicalProject('TEM')).not.toBe(canonicalProject('TEM-3'));
  });

  it('maps ETW-2 to Etwatwa', () => {
    expect(canonicalProject('ETW-2')).toBe('Etwatwa');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(canonicalProject('  tem-3 ')).toBe('Thembisa POP 3');
    expect(canonicalProject(' lawley')).toBe('Lawley');
  });

  it('trims the canonical name itself — projects.project_name holds "Middelburg " with a trailing space', () => {
    expect(canonicalProject('Middelburg ')).toBe('Middelburg');
    expect(canonicalProject('Middelburg')).toBe('Middelburg');
  });

  it('passes an unmapped project through unchanged rather than dropping it', () => {
    // Dropping would silently shrink totals; an unmapped label in the output is
    // visible and can be fixed. Never bucket an unknown project into Unknown.
    expect(canonicalProject('Brand New Site')).toBe('Brand New Site');
    expect(canonicalProject('Grabouw')).toBe('Grabouw');
  });

  it('maps null/empty to an explicit Unknown bucket, never an empty string', () => {
    expect(canonicalProject(null)).toBe(UNKNOWN_PROJECT);
    expect(canonicalProject(undefined)).toBe(UNKNOWN_PROJECT);
    expect(canonicalProject('')).toBe(UNKNOWN_PROJECT);
    expect(canonicalProject('   ')).toBe(UNKNOWN_PROJECT);
  });

  it('contains only aliases verified against real data', () => {
    // Guards against speculative entries. An earlier draft mapped MOH/MOA to
    // Mohadin; neither string occurs as a project value anywhere in the database
    // (that memory was about 1Map *site codes*, a different field entirely).
    expect(Object.keys(PROJECT_ALIASES).sort()).toEqual(['etw-2', 'tem', 'tem-3']);
  });

  it('never maps two different aliases onto each other', () => {
    // A canonical target must not itself be an alias key, or folding becomes
    // order-dependent and one application is not idempotent.
    for (const target of Object.values(PROJECT_ALIASES)) {
      expect(PROJECT_ALIASES[target.toLowerCase()]).toBeUndefined();
    }
  });

  it('is idempotent — folding an already-canonical name changes nothing', () => {
    for (const target of Object.values(PROJECT_ALIASES)) {
      expect(canonicalProject(target)).toBe(target);
    }
  });
});
