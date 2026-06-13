import { describe, it, expect } from 'vitest';
import {
  extractTypedOntSerial,
  extractTypedUpsSerial,
  extractTypedSerials,
} from '../waTypedSerialExtractor';

// Samples below are REAL production wa_original_text strings (queried from
// dr_photo_unified_reviews on 2026-06-13) — the exact gap rec #5 closes.

describe('extractTypedOntSerial — Nokia (ALCL/ALCB)', () => {
  it.each([
    ['DR1734962 ONT ALCB47D5A8F 6527 JOY STREET', 'ALCB47D5A8F'],
    ['DR1855084 ALCLB477AED3 Active', 'ALCLB477AED3'],
    ['Pon 84 4436 S/N:ALCLB48E394B DR1747382 MAIN HOUSE', 'ALCLB48E394B'],
    ['Pon 41 DR1742639 S/N:ALCLB48DF570 5245 Simelane street', 'ALCLB48DF570'],
    ['PON 77 DR1744946 N/S:ALCLB48E9655 4285 SIMBONGILE STREET', 'ALCLB48E9655'],
    ['DR1870071 S/N:ALCLB48EA2CE LINK LIGHT FLICKERING  PLEASE ASSIST', 'ALCLB48EA2CE'],
    ['PON:192 DR1751584 S/N: ALCLB465A0AD 8540 AMINOMA STREET', 'ALCLB465A0AD'],
    // period separator ("ONT.<serial>") — real DR1738608
    ["DR1738608 ONT.ALCLB48DC48 6332 SIMELANE STREET NO POWER", 'ALCLB48DC48'],
    // tech dropped the leading B (ALCL.. not ALCLB..) — real DR1859403; we extract
    // exactly what was typed (a downstream serial_other_dr is the intended signal).
    ['House number: 20477/52 DR1859403 S/N: ALCL48AE475 Status: active', 'ALCL48AE475'],
  ])('extracts the ONT serial from %j', (text, expected) => {
    expect(extractTypedOntSerial(text)).toBe(expected);
  });

  it('normalises case to uppercase', () => {
    expect(extractTypedOntSerial('s/n alclb477aed3')).toBe('ALCLB477AED3');
  });

  it('resolves when the same serial is repeated', () => {
    expect(extractTypedOntSerial('ALCLB477AED3 confirmed ALCLB477AED3')).toBe('ALCLB477AED3');
  });
});

describe('extractTypedOntSerial — Huawei (HWTC)', () => {
  it('extracts an HWTC serial', () => {
    expect(extractTypedOntSerial('DR1234567 ONT HWTC8B9A1C2D installed')).toBe('HWTC8B9A1C2D');
  });
});

describe('extractTypedOntSerial — anti-fabrication & negatives', () => {
  it('returns null when two DISTINCT ONT serials appear (ambiguous)', () => {
    expect(extractTypedOntSerial('is it ALCLB477AED3 or ALCLB48E394B ?')).toBeNull();
  });

  it('returns null when there is no serial', () => {
    expect(extractTypedOntSerial('DR1734962 customer not home, please reschedule')).toBeNull();
  });

  it('does not treat a DR number as a serial', () => {
    expect(extractTypedOntSerial('DR1747382 no signal')).toBeNull();
  });

  it('does not match a Gizzu UPS serial as an ONT', () => {
    expect(extractTypedOntSerial('DR1 UPS GU18W12V2509045437')).toBeNull();
  });

  it.each([null, undefined, ''])('returns null for %j', (text) => {
    expect(extractTypedOntSerial(text)).toBeNull();
  });
});

describe('extractTypedUpsSerial — Gizzu (GU…)', () => {
  it.each([
    'GU18W12V2509045437',
    'GU18W12V25113492',
    'GU18W12V2500164',
  ])('extracts %s', (serial) => {
    expect(extractTypedUpsSerial(`DR1234567 UPS ${serial}`)).toBe(serial);
  });

  it('strips a hyphen from a legacy Gizzu label so it equals the scanned/1Map value', () => {
    expect(extractTypedUpsSerial('DR1234567 UPS GU18W12V25-09045437')).toBe('GU18W12V2509045437');
  });

  it('returns null when no UPS serial is present', () => {
    expect(extractTypedUpsSerial('DR1234567 ONT ALCLB477AED3 only')).toBeNull();
  });

  it('returns null on two distinct UPS serials', () => {
    expect(extractTypedUpsSerial('GU18W12V2500164 or GU18W12V25113492')).toBeNull();
  });

  it.each([null, undefined, ''])('returns null for %j', (text) => {
    expect(extractTypedUpsSerial(text)).toBeNull();
  });
});

describe('extractTypedSerials — both legs in one pass', () => {
  it('returns ONT and UPS together when both are typed', () => {
    expect(
      extractTypedSerials('DR1234567 ONT ALCLB477AED3 UPS GU18W12V2500164')
    ).toEqual({ ont: 'ALCLB477AED3', ups: 'GU18W12V2500164' });
  });

  it('returns nulls for an empty message', () => {
    expect(extractTypedSerials('')).toEqual({ ont: null, ups: null });
  });
});
