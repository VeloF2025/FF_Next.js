import { describe, it, expect } from 'vitest';
import { checkLocationDeletable } from '../services/locationService';

describe('checkLocationDeletable', () => {
  it('allows deletion when no stock is on hand', () => {
    expect(checkLocationDeletable(0)).toEqual({ deletable: true });
  });

  it('blocks deletion when stock is on hand and explains why', () => {
    const result = checkLocationDeletable(5);
    expect(result.deletable).toBe(false);
    expect(result.reason).toMatch(/5/);
    expect(result.reason).toMatch(/stock/i);
  });

  it('treats negative/NaN on-hand as blocked (defensive)', () => {
    expect(checkLocationDeletable(Number.NaN).deletable).toBe(false);
    expect(checkLocationDeletable(-1).deletable).toBe(false);
  });

  it('blocks deletion when fractional stock remains', () => {
    expect(checkLocationDeletable(0.001).deletable).toBe(false);
  });
});
