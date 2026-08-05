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
    const r = selectTicketGpsDisplay({ oesGps: OES, fibreflowGps: DESIGN, divergenceM: 1066 });
    expect(r.primary).toEqual(OES);
    expect(r.primaryIsOes).toBe(true);
  });

  it('falls back to the design position when there is no OES coordinate', () => {
    const r = selectTicketGpsDisplay({ fibreflowGps: DESIGN });
    expect(r.primary).toEqual(DESIGN);
    expect(r.primaryIsOes).toBe(false);
    expect(r.secondary).toBeNull();
  });

  it('prefers sow_drops over 1Map within the design lineage', () => {
    const r = selectTicketGpsDisplay({ fibreflowGps: DESIGN, onemapGps: ONEMAP });
    expect(r.primary).toEqual(DESIGN);
  });

  it('uses 1Map when sow_drops has nothing', () => {
    const r = selectTicketGpsDisplay({ onemapGps: ONEMAP });
    expect(r.primary).toEqual(ONEMAP);
  });

  it('falls back to the stored ticket coordinate last', () => {
    const r = selectTicketGpsDisplay({ ticketGps: STORED });
    expect(r.primary).toEqual(STORED);
    expect(r.primaryIsOes).toBe(false);
  });

  it('returns nothing when no source has a usable pair', () => {
    const r = selectTicketGpsDisplay({});
    expect(r.primary).toBeNull();
    expect(r.secondary).toBeNull();
    expect(r.divergenceM).toBeNull();
    expect(r.primaryIsOes).toBe(false);
  });

  it('ignores a half pair rather than rendering a broken point', () => {
    const r = selectTicketGpsDisplay({
      oesGps: { latitude: -26.7 },
      fibreflowGps: DESIGN,
    });
    expect(r.primary).toEqual(DESIGN);
    expect(r.primaryIsOes).toBe(false);
  });
});

describe('selectTicketGpsDisplay — surfacing disagreement', () => {
  it('shows both coordinates when they disagree beyond the threshold', () => {
    const r = selectTicketGpsDisplay({ oesGps: OES, fibreflowGps: DESIGN, divergenceM: 1066 });
    expect(r.secondary).toEqual(DESIGN);
    expect(r.divergenceM).toBe(1066);
  });

  it('shows only one coordinate when they agree closely', () => {
    const r = selectTicketGpsDisplay({ oesGps: OES, fibreflowGps: DESIGN, divergenceM: 12 });
    expect(r.secondary).toBeNull();
    expect(r.divergenceM).toBeNull();
  });

  it('treats the threshold itself as agreement, not disagreement', () => {
    const at = selectTicketGpsDisplay({
      oesGps: OES,
      fibreflowGps: DESIGN,
      divergenceM: GPS_DIVERGENCE_THRESHOLD_M,
    });
    expect(at.secondary).toBeNull();

    const just_over = selectTicketGpsDisplay({
      oesGps: OES,
      fibreflowGps: DESIGN,
      divergenceM: GPS_DIVERGENCE_THRESHOLD_M + 1,
    });
    expect(just_over.secondary).toEqual(DESIGN);
  });

  it('never shows a second coordinate when the design position is the primary', () => {
    // Nothing to compare it against — it would be showing the same pin twice.
    const r = selectTicketGpsDisplay({ fibreflowGps: DESIGN, divergenceM: 900 });
    expect(r.secondary).toBeNull();
  });

  it('does not show a second coordinate when divergence was never computed', () => {
    const r = selectTicketGpsDisplay({ oesGps: OES, fibreflowGps: DESIGN });
    expect(r.secondary).toBeNull();
  });
});
