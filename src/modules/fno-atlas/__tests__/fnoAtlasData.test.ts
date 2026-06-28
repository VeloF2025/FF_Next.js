import { describe, expect, it } from 'vitest';
import { fnoNetworks, scrapingTools } from '../data/fnoAtlasData';
import { filterFnos, findFnosForProject, getCoverageConfidenceSummary } from '../lib/fnoAtlasUtils';

describe('FNO Atlas data', () => {
  it('includes the strategic backhaul operators Hein asked for', () => {
    const names = fnoNetworks.map((network) => network.name);

    expect(names).toContain('DFA');
    expect(names).toContain('Liquid Intelligent Technologies');
  });

  it('includes township and low-LSM rollout operators', () => {
    const names = fnoNetworks.map((network) => network.name);

    expect(names).toEqual(expect.arrayContaining(['Fibertime', 'Net Nine Nine']));
  });

  it('recommends backhaul providers for metro route planning', () => {
    const matches = findFnosForProject('metro-backhaul').map((network) => network.id);

    expect(matches).toEqual(expect.arrayContaining(['dfa', 'liquid', 'seacom']));
  });

  it('recommends prepaid and rural-edge operators for low-LSM rollouts', () => {
    const matches = findFnosForProject('rural-low-lsm').map((network) => network.id);

    expect(matches).toEqual(expect.arrayContaining(['fibertime', 'net99', 'herotel']));
  });

  it('filters by region, type and free text', () => {
    const results = filterFnos('backhaul', 'Gauteng', 'Metro Backhaul');

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((network) => network.strongRegions.includes('Gauteng'))).toBe(true);
    expect(results.every((network) => network.types.includes('Metro Backhaul'))).toBe(true);
  });

  it('keeps a confidence summary for source quality', () => {
    const summary = getCoverageConfidenceSummary();

    expect(summary.High + summary.Medium + summary['Needs verification']).toBe(fnoNetworks.length);
  });

  it('selects Crawlee plus Playwright as the primary scraping stack', () => {
    const primary = scrapingTools.find((tool) => tool.verdict === 'Recommended');

    expect(primary?.name).toBe('Crawlee + Playwright');
  });
});
