import { describe, it, expect } from 'vitest';
import { ALL_REPORT_SLUGS, REPORT_CATALOGUE } from '../types';
import { isReportSlug } from '../runner';

describe('geofence-patterns slug is wired', () => {
  it('appears in ALL_REPORT_SLUGS', () => {
    expect(ALL_REPORT_SLUGS).toContain('geofence-patterns');
  });

  it('appears in REPORT_CATALOGUE with date_range + departments_text inputs', () => {
    const def = REPORT_CATALOGUE.find((r) => r.slug === 'geofence-patterns');
    expect(def).toBeDefined();
    expect(def!.title).toMatch(/archetype|pattern/i);
    const inputKinds = def!.inputs.map((i) => i.kind);
    expect(inputKinds).toContain('date_range');
    expect(inputKinds).toContain('departments_text');
  });

  it('isReportSlug recognises the new slug', () => {
    expect(isReportSlug('geofence-patterns')).toBe(true);
  });
});
