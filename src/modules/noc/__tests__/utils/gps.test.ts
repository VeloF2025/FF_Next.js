/**
 * Pins the coordinate the ticket UI actually shows a technician.
 *
 * This logic lived inline in TicketHeader and shipped untested — a blind review
 * caught it. It is the last decision point before a person drives somewhere, so
 * "OES wins", "both are shown when they disagree", and "half a pair is not a
 * location" all need to be falsifiable.
 */
import { describe, it, expect } from 'vitest';
import {
  selectTicketGpsDisplay,
  isDisplayPoint,
  parseStoredGps,
  isResolvableSerial,
  ranksOesFirst,
  GPS_DIVERGENCE_THRESHOLD_M,
} from '@/modules/noc/utils/gps';

const OES = { latitude: -26.7387387, longitude: 27.0148998 };
const DESIGN = { latitude: -26.7295508, longitude: 27.0179814 };
const ONEMAP = { latitude: -26.72, longitude: 27.01 };
const STORED = { latitude: -26.5, longitude: 27.5 };

describe('isDisplayPoint', () => {
  it('accepts a complete numeric pair', () => {
    expect(isDisplayPoint(OES)).toBe(true);
  });

  it('rejects half a pair, non-numbers and non-objects', () => {
    expect(isDisplayPoint({ latitude: -26.7 })).toBe(false);
    expect(isDisplayPoint({ longitude: 27.0 })).toBe(false);
    expect(isDisplayPoint({ latitude: '-26.7', longitude: '27.0' })).toBe(false);
    expect(isDisplayPoint({ latitude: NaN, longitude: 27 })).toBe(false);
    expect(isDisplayPoint(null)).toBe(false);
    expect(isDisplayPoint(undefined)).toBe(false);
    expect(isDisplayPoint('-26.7,27.0')).toBe(false);
  });
});

describe('selectTicketGpsDisplay — which coordinate the tech is sent to', () => {
  it('shows the OES coordinate ahead of the design position', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', oesGps: OES, fibreflowGps: DESIGN, divergenceM: 1066 });
    expect(r.primary).toEqual(OES);
    expect(r.primaryIsOes).toBe(true);
  });

  it('falls back to the design position when there is no OES coordinate', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', fibreflowGps: DESIGN });
    expect(r.primary).toEqual(DESIGN);
    expect(r.primaryIsOes).toBe(false);
    expect(r.secondary).toBeNull();
  });

  it('prefers sow_drops over 1Map within the design lineage', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', fibreflowGps: DESIGN, onemapGps: ONEMAP });
    expect(r.primary).toEqual(DESIGN);
  });

  it('uses 1Map when sow_drops has nothing', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', onemapGps: ONEMAP });
    expect(r.primary).toEqual(ONEMAP);
  });

  it('falls back to the stored ticket coordinate last', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', ticketGps: STORED });
    expect(r.primary).toEqual(STORED);
    expect(r.primaryIsOes).toBe(false);
  });

  it('returns nothing when no source has a usable pair', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch' });
    expect(r.primary).toBeNull();
    expect(r.secondary).toBeNull();
    expect(r.divergenceM).toBeNull();
    expect(r.primaryIsOes).toBe(false);
  });

  it('ignores a half pair rather than rendering a broken point', () => {
    const r = selectTicketGpsDisplay({
      ticketSource: 'olt_mismatch',
      oesGps: { latitude: -26.7 },
      fibreflowGps: DESIGN,
    });
    expect(r.primary).toEqual(DESIGN);
    expect(r.primaryIsOes).toBe(false);
  });
});

describe('selectTicketGpsDisplay — surfacing disagreement', () => {
  it('shows both coordinates when they disagree beyond the threshold', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', oesGps: OES, fibreflowGps: DESIGN, divergenceM: 1066 });
    expect(r.secondary).toEqual(DESIGN);
    expect(r.divergenceM).toBe(1066);
  });

  it('shows only one coordinate when they agree closely', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', oesGps: OES, fibreflowGps: DESIGN, divergenceM: 12 });
    expect(r.secondary).toBeNull();
    expect(r.divergenceM).toBeNull();
  });

  it('treats the threshold itself as agreement, not disagreement', () => {
    const at = selectTicketGpsDisplay({
      ticketSource: 'olt_mismatch',
      oesGps: OES,
      fibreflowGps: DESIGN,
      divergenceM: GPS_DIVERGENCE_THRESHOLD_M,
    });
    expect(at.secondary).toBeNull();

    const just_over = selectTicketGpsDisplay({
      ticketSource: 'olt_mismatch',
      oesGps: OES,
      fibreflowGps: DESIGN,
      divergenceM: GPS_DIVERGENCE_THRESHOLD_M + 1,
    });
    expect(just_over.secondary).toEqual(DESIGN);
  });

  it('never shows a second coordinate when the design position is the primary', () => {
    // Nothing to compare it against — it would be showing the same pin twice.
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', fibreflowGps: DESIGN, divergenceM: 900 });
    expect(r.secondary).toBeNull();
  });

  it('does not show a second coordinate when divergence was never computed', () => {
    const r = selectTicketGpsDisplay({ ticketSource: 'olt_mismatch', oesGps: OES, fibreflowGps: DESIGN });
    expect(r.secondary).toBeNull();
  });
});

describe('OES ranking is scoped to the ticket sources it is justified for', () => {
  const OES_FAR = { latitude: -25.5457433, longitude: 27.9828739 };
  const CAPTURED = { latitude: -26.38318537404762, longitude: 27.80789118854532 };

  it.each(['olt_mismatch', 'wa_no_oes', 'pp_data'])(
    'ranks OES first for %s — the DR link is what is under investigation',
    (source) => {
      const r = selectTicketGpsDisplay({ ticketSource: source, oesGps: OES_FAR, fibreflowGps: CAPTURED });
      expect(r.primary).toEqual(OES_FAR);
      expect(r.primaryIsOes).toBe(true);
    }
  );

  it.each(['snags', 'manual', 'construction', 'ont_swap', 'qcontact', 'weekly_report'])(
    'ignores OES entirely for %s',
    (source) => {
      // Real case: DR1734917 has four open snags tickets whose captured position
      // is 6m from the design point, while its OES row sits 94.7km away near
      // Brits. Ranking OES first there sends the technician to another town.
      const r = selectTicketGpsDisplay({ ticketSource: source, oesGps: OES_FAR, fibreflowGps: CAPTURED });
      expect(r.primary).toEqual(CAPTURED);
      expect(r.primaryIsOes).toBe(false);
      expect(r.secondary).toBeNull();
    }
  );

  it('ignores OES when the source is missing entirely', () => {
    const r = selectTicketGpsDisplay({ oesGps: OES_FAR, fibreflowGps: CAPTURED });
    expect(r.primary).toEqual(CAPTURED);
    expect(r.primaryIsOes).toBe(false);
  });

  it('still shows a snags ticket its own stored capture when nothing else exists', () => {
    const r = selectTicketGpsDisplay({
      ticketSource: 'snags',
      oesGps: OES_FAR,
      ticketGps: '-26.38318537404762,27.80789118854532',
    });
    expect(r.primary).toEqual(CAPTURED);
    expect(r.primaryIsOes).toBe(false);
  });

  it('ranksOesFirst identifies exactly the three sources', () => {
    expect(ranksOesFirst('olt_mismatch')).toBe(true);
    expect(ranksOesFirst('snags')).toBe(false);
    expect(ranksOesFirst(null)).toBe(false);
    expect(ranksOesFirst(undefined)).toBe(false);
    expect(ranksOesFirst('')).toBe(false);
  });
});

describe('parseStoredGps — gps_coordinates arrives as TEXT, not an object', () => {
  it('parses the "lat,lng" string the API actually returns', () => {
    // getTicketById does SELECT t.*, and the route spreads the row into JSON,
    // so the client sees the raw text column. Requiring an object here meant
    // the stored tier never fired for any ticket.
    expect(parseStoredGps('-26.7387387,27.0148998')).toEqual({
      latitude: -26.7387387,
      longitude: 27.0148998,
    });
  });

  it('accepts an already-parsed point unchanged', () => {
    const p = { latitude: -26.5, longitude: 27.5 };
    expect(parseStoredGps(p)).toEqual(p);
  });

  it('rejects malformed, empty, null-island and non-string input', () => {
    expect(parseStoredGps('')).toBeNull();
    expect(parseStoredGps('-26.7')).toBeNull();
    expect(parseStoredGps('-26.7,27.0,1')).toBeNull();
    expect(parseStoredGps('not,coords')).toBeNull();
    expect(parseStoredGps('0,0')).toBeNull();
    expect(parseStoredGps(null)).toBeNull();
    expect(parseStoredGps(undefined)).toBeNull();
    expect(parseStoredGps(42)).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseStoredGps(' -26.7387387 , 27.0148998 ')).toEqual({
      latitude: -26.7387387,
      longitude: 27.0148998,
    });
  });
});

describe('isResolvableSerial — placeholders must not resolve to a stranger', () => {
  it('rejects the placeholders that exist in production', () => {
    // 50 oes_activations rows carry serial_number = '-', across 50 unrelated
    // DRs up to ~115km apart.
    expect(isResolvableSerial('-')).toBe(false);
    expect(isResolvableSerial('--')).toBe(false);
    expect(isResolvableSerial('------')).toBe(false);
    expect(isResolvableSerial('  -  ')).toBe(false);
    expect(isResolvableSerial('N/A')).toBe(false);
    expect(isResolvableSerial('')).toBe(false);
    expect(isResolvableSerial(null)).toBe(false);
    expect(isResolvableSerial(undefined)).toBe(false);
  });

  it('accepts real ONT serials', () => {
    expect(isResolvableSerial('ALCLB48E394B')).toBe(true);
    expect(isResolvableSerial(' ALCLB48E394B ')).toBe(true);
    expect(isResolvableSerial('HWTC1234ABCD')).toBe(true);
  });
});
