/**
 * The locality string, and the guard on what counts as "near".
 *
 * These are small pure functions whose failures are cosmetic-looking and therefore survive: a
 * missing field silently becoming ", , Gauteng", or a null rendering as the literal text "null" in
 * a report someone then sends to a client.
 */
import { describe, expect, it } from 'vitest';
import { toLocality, NEAREST_PLACE_MAX_M, GEOCODE_INTERVAL_MS } from '../placeResolver';

describe('toLocality', () => {
  it('joins the three parts in administrative order', () => {
    expect(toLocality({ city: 'Centurion', municipalDistrict: 'City of Tshwane', province: 'Gauteng' }))
      .toBe('Centurion, City of Tshwane, Gauteng');
  });

  it('omits a missing part rather than leaving a hole in the string', () => {
    // The failure this prevents: ", City of Tshwane, Gauteng" or "Centurion, , Gauteng".
    expect(toLocality({ municipalDistrict: 'City of Tshwane', province: 'Gauteng' }))
      .toBe('City of Tshwane, Gauteng');
    expect(toLocality({ city: 'Centurion', province: 'Gauteng' }))
      .toBe('Centurion, Gauteng');
  });

  it('treats a blank or whitespace-only part as missing', () => {
    expect(toLocality({ city: '', municipalDistrict: '   ', province: 'Gauteng' })).toBe('Gauteng');
  });

  it('returns null rather than an empty string when nothing is known', () => {
    // An empty string would be stored and rendered as a blank place; null means "not resolved"
    // and is retried by a later pass.
    expect(toLocality({})).toBeNull();
    expect(toLocality({ city: '', municipalDistrict: '', province: '' })).toBeNull();
  });

  it('returns null for a null geocode, never the text "null"', () => {
    expect(toLocality(null)).toBeNull();
  });

  it('handles a single known part', () => {
    expect(toLocality({ province: 'Gauteng' })).toBe('Gauteng');
  });
});

describe('resolver limits', () => {
  it('paces geocoding above one request per second', () => {
    // Nominatim's acceptable-use policy is 1 req/s. Anything at or below 1000ms is a policy
    // breach that would get the shared IP blocked — taking parking compliance down with it.
    expect(GEOCODE_INTERVAL_MS).toBeGreaterThan(1000);
  });

  it('keeps the nearest-place radius tight enough to be meaningful', () => {
    // Naming a place 5km away as "nearest" would be actively misleading on a report.
    expect(NEAREST_PLACE_MAX_M).toBeGreaterThan(0);
    expect(NEAREST_PLACE_MAX_M).toBeLessThanOrEqual(1000);
  });
});
