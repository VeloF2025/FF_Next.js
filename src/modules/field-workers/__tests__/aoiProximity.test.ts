import { describe, it, expect } from 'vitest';
import {
  classifyProximity,
  formatDistance,
  proximityLabel,
  NEAR_THRESHOLD_M,
} from '../aoiProximity';

describe('classifyProximity', () => {
  it('treats 0 as on site, not as missing data', () => {
    // The whole point: 0 is falsy, so a `!distance` guard would report every
    // worker who was actually standing on the site as unknown.
    expect(classifyProximity(0)).toBe('on_site');
  });

  it('separates near from off site at the threshold', () => {
    expect(classifyProximity(NEAR_THRESHOLD_M - 1)).toBe('near');
    expect(classifyProximity(NEAR_THRESHOLD_M)).toBe('off_site');
  });

  it('reports unknown only for genuinely absent values', () => {
    expect(classifyProximity(null)).toBe('unknown');
    expect(classifyProximity(undefined)).toBe('unknown');
    expect(classifyProximity(Number.NaN)).toBe('unknown');
    // ...and NOT for a real measurement, however small.
    expect(classifyProximity(0.01)).toBe('near');
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre and km above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(412.6)).toBe('413 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(12_430)).toBe('12.4 km');
  });

  it('returns empty string rather than "NaN m" for absent values', () => {
    expect(formatDistance(null)).toBe('');
    expect(formatDistance(Number.NaN)).toBe('');
  });
});

describe('proximityLabel', () => {
  it('names the site only when the worker was on it', () => {
    expect(proximityLabel('Lawley', 0)).toBe('Lawley');
  });

  it('shows distance, never the site name, when off site', () => {
    // Naming the nearest project for a 30 km fix would claim they were at a
    // site they may never have visited.
    const label = proximityLabel('Lawley', 30_000);
    expect(label).toBe('30.0 km');
    expect(label).not.toContain('Lawley');
  });

  it('falls back to a generic label when on site but the project name is missing', () => {
    expect(proximityLabel(null, 0)).toBe('on site');
  });

  it('renders nothing when no distance was recorded', () => {
    expect(proximityLabel('Lawley', null)).toBe('');
  });
});
