import { describe, it, expect } from 'vitest';
import {
  isPlausibleSaCoordinate,
  haversineMeters,
  resolveTicketGps,
  formatGpsColumn,
  GPS_DIVERGENCE_THRESHOLD_M,
} from '@/modules/noc/services/ticketGpsService';

describe('isPlausibleSaCoordinate', () => {
  it('accepts coordinates inside the South African footprint', () => {
    expect(isPlausibleSaCoordinate(-26.7236, 27.0195)).toBe(true); // Mohadin
    expect(isPlausibleSaCoordinate(-25.6984, 28.3989)).toBe(true); // Mamelodi
    expect(isPlausibleSaCoordinate('-26.3859833', '27.8060471')).toBe(true); // pg ::text
  });

  it('rejects the real out-of-bounds OES rows found in production', () => {
    // 13 of 25,414 oes_activations rows land outside SA — a few activation
    // devices report a bogus fix. Left unfiltered these replace a 20 m error
    // with an 8,700 km one.
    expect(isPlausibleSaCoordinate(26.6458226, 87.7349221)).toBe(false); // Nepal
    expect(isPlausibleSaCoordinate(-6.333144, 106.8690632)).toBe(false); // Indonesia
    expect(isPlausibleSaCoordinate(32.5410333, 45.8294376)).toBe(false); // Iraq
  });

  it('rejects null island, nulls and unparseable input', () => {
    expect(isPlausibleSaCoordinate(0, 0)).toBe(false);
    expect(isPlausibleSaCoordinate(null, null)).toBe(false);
    expect(isPlausibleSaCoordinate(undefined, 27.0)).toBe(false);
    expect(isPlausibleSaCoordinate('not-a-number', '27.0')).toBe(false);
    expect(isPlausibleSaCoordinate(NaN, 27.0)).toBe(false);
  });

  it('rejects a swapped lat/lng pair', () => {
    // -26.72,27.01 is valid; swapping puts latitude at 27 (northern hemisphere).
    expect(isPlausibleSaCoordinate(27.0195, -26.7236)).toBe(false);
  });
});

describe('haversineMeters', () => {
  it('measures a known separation', () => {
    // DR1863200: design -26.7295508,27.0179814 vs OES -26.7387387,27.0148998.
    // Measured at 1,066 m in Postgres; allow a metre of float drift.
    const d = haversineMeters(
      { latitude: -26.7295508, longitude: 27.0179814 },
      { latitude: -26.7387387, longitude: 27.0148998 }
    );
    expect(d).toBeGreaterThan(1060);
    expect(d).toBeLessThan(1072);
  });

  it('is zero for identical points and symmetric', () => {
    const a = { latitude: -26.7236, longitude: 27.0195 };
    const b = { latitude: -26.72, longitude: 27.02 };
    expect(haversineMeters(a, a)).toBe(0);
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('resolveTicketGps', () => {
  const oes = { latitude: -26.7387387, longitude: 27.0148998 };
  const design = { latitude: -26.7295508, longitude: 27.0179814 };

  it('ranks the OES activation coordinate above the design position', () => {
    expect(resolveTicketGps(oes, design)).toEqual({ point: oes, source: 'oes_report' });
  });

  it('falls back to the design position when there is no OES row', () => {
    expect(resolveTicketGps(null, design)).toEqual({ point: design, source: 'design' });
  });

  it('falls back to the design position when the OES coordinate is out of bounds', () => {
    const bogus = { latitude: 26.6458226, longitude: 87.7349221 }; // Nepal
    expect(resolveTicketGps(bogus, design)).toEqual({ point: design, source: 'design' });
  });

  it('returns null when neither source has a coordinate', () => {
    expect(resolveTicketGps(null, null)).toBeNull();
    expect(resolveTicketGps(undefined, undefined)).toBeNull();
  });

  it('does not fall back to the design position when it is not a real pair', () => {
    expect(resolveTicketGps(null, { latitude: NaN, longitude: 27.0 })).toBeNull();
  });

  it('returns an out-of-bounds OES point never — even with no design fallback', () => {
    // Better to show no location than a location in Nepal.
    expect(resolveTicketGps({ latitude: 26.64, longitude: 87.73 }, null)).toBeNull();
  });
});

describe('formatGpsColumn', () => {
  it('serialises to the "lat,lng" shape the text column stores', () => {
    expect(formatGpsColumn({ latitude: -26.7236, longitude: 27.0195 })).toBe('-26.7236,27.0195');
  });

  it('round-trips through the SPLIT_PART parsing used by nearby-tickets', () => {
    const s = formatGpsColumn({ latitude: -26.7236, longitude: 27.0195 });
    expect(parseFloat(s.split(',')[0] as string)).toBeCloseTo(-26.7236, 6);
    expect(parseFloat(s.split(',')[1] as string)).toBeCloseTo(27.0195, 6);
  });
});

describe('GPS_DIVERGENCE_THRESHOLD_M', () => {
  it('sits above GPS noise but below a wrong-house error', () => {
    expect(GPS_DIVERGENCE_THRESHOLD_M).toBe(50);
  });
});
