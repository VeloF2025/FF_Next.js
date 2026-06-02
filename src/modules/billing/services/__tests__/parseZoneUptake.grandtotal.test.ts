import { describe, it, expect } from 'vitest';
import {
  computeGrandTotal,
  type ZoneUptakeRow,
  type ZonePonUptakeRow,
} from '../parseZoneUptake';

const zone = (zoneNo: number, plannedDrops: number, installed: number): ZoneUptakeRow => ({
  zoneNo,
  plannedDrops,
  installed,
  pctInstalled: plannedDrops > 0 ? (installed / plannedDrops) * 100 : 0,
});

const pon = (
  zoneNo: number,
  ponNo: number,
  plannedDrops: number,
  installed: number,
): ZonePonUptakeRow => ({
  zoneNo,
  ponNo,
  plannedDrops,
  installed,
  pctInstalled: plannedDrops > 0 ? (installed / plannedDrops) * 100 : 0,
});

describe('computeGrandTotal', () => {
  it('uses the explicit "Grand Total" footer line when present (authoritative)', () => {
    const { grandTotal, warning } = computeGrandTotal(
      'Grand Total               23710     7479        32%',
      [zone(1, 1000, 500)], // ignored in favour of the explicit line
      [],
    );
    expect(grandTotal).toEqual({ plannedDrops: 23710, installed: 7479, pctInstalled: 32 });
    expect(warning).toBeNull();
  });

  it('derives the total from zone rows when there is NO Grand Total (Tembisa Drop/Spare split)', () => {
    // Mirrors Tembisa POP01: drop zone 17 installed 352, spare zones sum 27 → 379.
    const zones = [
      zone(17, 1660, 379), // merged Drop(1633,352) + Spare(27,27) after dedupe
      zone(1, 1895, 0),
      zone(2, 120, 0),
    ];
    const { grandTotal, warning } = computeGrandTotal(undefined, zones, []);
    expect(grandTotal.installed).toBe(379);
    expect(grandTotal.plannedDrops).toBe(1660 + 1895 + 120);
    expect(warning).toMatch(/derived from 3 parsed rows/);
  });

  it('prefers zone rollups over PON rows when both are present (no double-count)', () => {
    // Per-pon variant: zone rows are "<N> Total" rollups = sum of that zone's
    // PONs. Summing zones must equal summing pons; the function must pick one
    // (zones) and not add both.
    const zones = [zone(1, 231, 143), zone(2, 120, 0)];
    const pons = [pon(1, 1, 119, 69), pon(1, 2, 112, 74), pon(2, 17, 120, 0)];
    const { grandTotal, warning } = computeGrandTotal(undefined, zones, pons);
    expect(grandTotal.installed).toBe(143); // zone sum, not 143+143
    expect(grandTotal.plannedDrops).toBe(351);
    expect(warning).toMatch(/derived from 2 parsed rows/); // 2 = zone rows used
  });

  it('falls back to PON rows when there are no zone rollups (per-pon variant)', () => {
    const pons = [pon(1, 1, 119, 69), pon(1, 2, 112, 74), pon(2, 17, 120, 0)];
    const { grandTotal, warning } = computeGrandTotal(undefined, [], pons);
    expect(grandTotal.installed).toBe(143);
    expect(grandTotal.plannedDrops).toBe(351);
    expect(warning).toMatch(/derived from 3 parsed rows/);
  });

  it('warns and returns zeros when there is no footer and no rows', () => {
    const { grandTotal, warning } = computeGrandTotal(undefined, [], []);
    expect(grandTotal).toEqual({ plannedDrops: 0, installed: 0, pctInstalled: 0 });
    expect(warning).toBe('Grand Total line not found in uptake PDF');
  });

  it('warns when a Grand Total line is present but lacks 3 numbers', () => {
    const { grandTotal, warning } = computeGrandTotal('Grand Total   42', [], []);
    expect(grandTotal).toEqual({ plannedDrops: 0, installed: 0, pctInstalled: 0 });
    expect(warning).toMatch(/could not parse 3 numbers/);
  });
});
