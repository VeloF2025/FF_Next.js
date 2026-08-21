/**
 * serialsEligibleForIntake — what a raw scan payload actually corroborates.
 *
 * This is the trust boundary for taking stock in that the sheet has never
 * listed. The earlier design let the CLIENT assert "this was machine-read",
 * which meant the protection its own rationale depended on could be defeated
 * by always sending the flag. The server now re-derives the answer from the
 * raw payload with the same parser the scanner uses.
 *
 * It is corroboration, not proof — a determined caller with a valid stores
 * session could synthesise a payload. What it removes is the ACCIDENTAL path:
 * a mistyped serial silently becoming permanent phantom stock.
 */
import { describe, it, expect } from 'vitest';
import { serialsEligibleForIntake } from '../boxScan';

// The real 2026-08-21 carton payload shape: semicolon-separated serial list.
const CARTON = 'ALCLB49486FF;ALCLB4948758;ALCLB4948779;ALCLB49488FC;ALCLB4949054;'
  + 'ALCLB4949388;ALCLB4949DEF;ALCLB4949F2F;ALCLB4949F3C';

describe('serialsEligibleForIntake', () => {
  it('corroborates every serial the carton lists', () => {
    const eligible = serialsEligibleForIntake(CARTON);
    expect(eligible.size).toBe(9);
    for (const sn of CARTON.split(';')) {
      expect(eligible.has(sn), `${sn} should be eligible`).toBe(true);
    }
  });

  it('does NOT corroborate a serial the payload never mentioned', () => {
    // The attack the client-flag design could not stop: smuggling an extra
    // serial alongside a genuine carton scan.
    const eligible = serialsEligibleForIntake(CARTON);
    expect(eligible.has('ALCLB4900000')).toBe(false);
  });

  it('corroborates nothing for a hand-typed serial', () => {
    // A typed serial is not a carton payload and can never become one.
    expect(serialsEligibleForIntake('ALCLB49486FF').size).toBe(0);
  });

  it('corroborates nothing for a typo', () => {
    expect(serialsEligibleForIntake('ALCLB4948GFF').size).toBe(0);
    expect(serialsEligibleForIntake('2ALCLB4922CF2').size).toBe(0);
  });

  it('corroborates nothing for an absent, empty, or non-string payload', () => {
    // Every one of these must fail closed.
    expect(serialsEligibleForIntake(null).size).toBe(0);
    expect(serialsEligibleForIntake(undefined).size).toBe(0);
    expect(serialsEligibleForIntake('').size).toBe(0);
    expect(serialsEligibleForIntake(123 as unknown as string).size).toBe(0);
    expect(serialsEligibleForIntake({} as unknown as string).size).toBe(0);
    expect(serialsEligibleForIntake(['ALCLB49486FF'] as unknown as string).size).toBe(0);
  });

  it('corroborates nothing for a SINGLE scanned serial', () => {
    // A lone code carries nothing to cross-check. A carton lists its siblings
    // and declares its own count, which is why only a box qualifies.
    expect(serialsEligibleForIntake('ALCLB49486FF;').size).toBe(0);
  });

  it('corroborates nothing for the carton data code, which lists no serials', () => {
    // The small ISO square carries part number and quantity, not serials.
    const RS = String.fromCharCode(30);
    const GS = String.fromCharCode(29);
    const dataCode = `[)>${RS}06${GS}1P3TN01414BA${GS}Q9${GS}3SM022540${RS}`;
    expect(serialsEligibleForIntake(dataCode).size).toBe(0);
  });
});
