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

  it('is case-insensitive and trims spaces', () => {
    expect(canonicalProject('  tem-3 ')).toBe('Thembisa POP 3');
    expect(canonicalProject(' lawley')).toBe('Lawley');
  });

  it('trims tabs, newlines and NBSP — not just spaces', () => {
    // .trim() would pass these for free, but the SQL twin uses btrim with an
    // explicit character set, and single-argument btrim strips ONLY U+0020.
    // Both sides therefore name the set, and these pin it.
    expect(canonicalProject('\tTEM\t')).toBe('Thembisa POP 1');
    expect(canonicalProject('\nTEM\r\n')).toBe('Thembisa POP 1');
    expect(canonicalProject('\u00a0TEM\u00a0')).toBe('Thembisa POP 1');
    expect(canonicalProject('\u00a0')).toBe(UNKNOWN_PROJECT);
  });

  it('returns a string for prototype-shaped keys, not an inherited object', () => {
    // A plain object literal inherits Object.prototype, so obj['__proto__'] is the
    // prototype and obj['constructor'] is a function — both truthy, so `??` never
    // fires and a non-string escapes. SQL just passes these through, so the object
    // form was also a parity break. Map has no inherited keys.
    expect(canonicalProject('__proto__')).toBe('__proto__');
    expect(canonicalProject('constructor')).toBe('constructor');
    expect(canonicalProject('toString')).toBe('toString');
    expect(typeof canonicalProject('__proto__')).toBe('string');
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
    expect([...PROJECT_ALIASES.keys()].sort()).toEqual(['etw-2', 'tem', 'tem-3']);
  });

  it('never maps two different aliases onto each other', () => {
    // A canonical target must not itself be an alias key, or folding becomes
    // order-dependent and one application is not idempotent.
    for (const target of PROJECT_ALIASES.values()) {
      expect(PROJECT_ALIASES.get(target.toLowerCase())).toBeUndefined();
    }
  });

  it('is idempotent — folding an already-canonical name changes nothing', () => {
    for (const target of PROJECT_ALIASES.values()) {
      expect(canonicalProject(target)).toBe(target);
    }
  });
});
