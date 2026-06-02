import { describe, it, expect } from 'vitest';
import { normalizeSaLatLon } from './normalizeSaLatLon';

describe('normalizeSaLatLon', () => {
  it('swaps a clearly-swapped SA coordinate (lat holds a longitude)', () => {
    // Mamelodi A353 as imported: latitude=+28.4 (a lon), longitude=-25.7 (a lat)
    expect(normalizeSaLatLon(28.40796982, -25.70806578)).toEqual({
      latitude: -25.70806578,
      longitude: 28.40796982,
    });
  });

  it('leaves an already-correct SA coordinate untouched', () => {
    // Mamelodi A348: correct order
    expect(normalizeSaLatLon(-25.70799682, 28.40817112)).toEqual({
      latitude: -25.70799682,
      longitude: 28.40817112,
    });
  });

  it('does not swap when only latitude is in the swapped range', () => {
    // longitude not in SA latitude range -> ambiguous, leave alone
    expect(normalizeSaLatLon(28.4, 10)).toEqual({ latitude: 28.4, longitude: 10 });
  });

  it('passes through null / undefined unchanged', () => {
    expect(normalizeSaLatLon(null, null)).toEqual({ latitude: null, longitude: null });
    expect(normalizeSaLatLon(undefined, undefined)).toEqual({
      latitude: undefined,
      longitude: undefined,
    });
    expect(normalizeSaLatLon(-25.7, undefined)).toEqual({
      latitude: -25.7,
      longitude: undefined,
    });
  });

  it('does not swap NaN coordinates', () => {
    expect(normalizeSaLatLon(NaN, 28.4)).toEqual({ latitude: NaN, longitude: 28.4 });
  });

  it('handles the boundary values of the swap signature', () => {
    // lat exactly 16 (min lon), lon exactly -22 (max lat) -> swap
    expect(normalizeSaLatLon(16, -22)).toEqual({ latitude: -22, longitude: 16 });
    // lat just below 16 -> not in lon range -> no swap
    expect(normalizeSaLatLon(15.99, -25.7)).toEqual({ latitude: 15.99, longitude: -25.7 });
  });
});
