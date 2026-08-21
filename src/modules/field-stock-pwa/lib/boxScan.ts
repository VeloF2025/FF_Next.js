/**
 * parseScanPayload — classify a decoded barcode payload from the stores scanner.
 *
 * Nokia ONT cartons carry three kinds of code side by side:
 *
 *  1. A large DataMatrix titled "FULL SERIAL NUMBER LIST IN PACKAGE" holding
 *     every serial in the box, semicolon-separated:
 *       ALCLB49486FF;ALCLB4948758;…      → kind 'box'
 *  2. A small DataMatrix ("ISO ALL DATA") in ISO/IEC 15434 Format 06 carrying
 *     the part number, quantity and package id but NO serials:
 *       [)>{RS}06{GS}1P3TN01414BA{GS}…Q9{GS}3SM022540…{RS}{EOT}
 *                                        → kind 'package-data'
 *  3. Per-unit Code128 barcodes, plain or S-prefixed (the label's ISO column).
 *                                        → kind 'single'
 *
 * The per-unit DataMatrix on an individual ONT wraps its serial in the same
 * ISO envelope under Data Identifier 'S' — that path is preserved verbatim
 * from the previous extractScannedSerial implementation.
 *
 * Unknown formats degrade to 'single' or 'unrecognised'. The parser never
 * invents serials from a payload it does not understand.
 */

// ASC MH10.8.2 / ISO 15434 separators (GS/RS/EOT control chars — intentional).
// eslint-disable-next-line no-control-regex
const SEPARATORS = /[\x1d\x1e\x04]+/;
const FORMAT_ENVELOPE = '[)>';
const SERIAL_SHAPE = /^[A-Z0-9]{8,20}$/;
const NOKIA_SERIAL_SHAPE = /^ALCL[A-Z0-9]{8}$/;

/** Callers cap a box at this many members; the parser itself returns all of them. */
export const MAX_BOX_SERIALS = 50;

export type ScanPayload =
  | { kind: 'box'; serials: string[] }
  | { kind: 'package-data'; partNumber?: string; quantity?: number; packageId?: string }
  | { kind: 'single'; serial: string }
  | { kind: 'unrecognised'; raw: string };

/**
 * Normalise one token to a serial, or null when it is not serial-shaped.
 * A leading 'S' is stripped ONLY when the remainder is a Nokia GPON serial —
 * the label's ISO column prints S-prefixed variants, but a genuine serial that
 * merely starts with S must never be mangled.
 */
function toSerial(token: string): string | null {
  const value = token.trim().toUpperCase();
  if (value.startsWith('S') && NOKIA_SERIAL_SHAPE.test(value.slice(1))) return value.slice(1);
  return SERIAL_SHAPE.test(value) ? value : null;
}

function parseIsoEnvelope(text: string): ScanPayload {
  const fields = text.split(SEPARATORS).map((f) => f.trim()).filter(Boolean);

  // Data Identifier 'S' (bare) carries a unit serial. Multi-character DIs are
  // digit-prefixed (1P, 3S, …), so a field matching /^S[0-9A-Za-z]/ is the
  // serial field and its value is the remainder.
  const serialField = fields.find((f) => /^S[0-9A-Za-z]/.test(f));
  if (serialField) {
    const serial = toSerial(serialField.slice(1));
    if (serial) return { kind: 'single', serial };
  }

  const di = (prefix: string): string | undefined => {
    const field = fields.find((f) => f.startsWith(prefix) && f.length > prefix.length);
    return field?.slice(prefix.length);
  };
  const quantityRaw = di('Q');
  const quantity =
    quantityRaw !== undefined && /^\d+$/.test(quantityRaw) ? Number(quantityRaw) : undefined;

  return {
    kind: 'package-data',
    partNumber: di('1P'),
    quantity,
    packageId: di('3S'),
  };
}

export function parseScanPayload(raw: string): ScanPayload {
  const text = (raw ?? '').trim();
  if (!text) return { kind: 'unrecognised', raw: '' };

  // An ISO envelope is only honoured when it OPENS the payload, or when the
  // payload has no semicolons at all. A string that carries both a serial list
  // and an envelope marker is a carton list first — routing it into the
  // envelope parser would silently discard the serials, which is worse than
  // either alternative. `includes` (rather than `startsWith` alone) is kept for
  // the no-semicolon case because some scanners prefix a stray byte.
  const isEnvelope =
    text.startsWith(FORMAT_ENVELOPE) || (!text.includes(';') && text.includes(FORMAT_ENVELOPE));
  if (isEnvelope) return parseIsoEnvelope(text);

  if (text.includes(';')) {
    const serials: string[] = [];
    const seen = new Set<string>();
    for (const token of text.split(';')) {
      const serial = toSerial(token);
      if (serial && !seen.has(serial)) {
        seen.add(serial);
        serials.push(serial);
      }
    }
    if (serials.length >= 2) return { kind: 'box', serials };
    if (serials.length === 1) return { kind: 'single', serial: serials[0]! };
    return { kind: 'unrecognised', raw: text };
  }

  const serial = toSerial(text);
  return serial ? { kind: 'single', serial } : { kind: 'unrecognised', raw: text };
}

/**
 * The serials a raw scan payload actually corroborates, for the purpose of
 * taking stock in that the sheet has never listed.
 *
 * The point is to stop "this was machine-read" being a bare client assertion.
 * A caller cannot simply claim a serial was scanned: it must supply the raw
 * decoded payload, and the server re-derives the serials from it with the same
 * parser the scanner uses. A typed serial — or a typo — cannot be a carton
 * payload, because that requires several semicolon-separated serial-shaped
 * tokens or a well-formed ISO envelope.
 *
 * This is CORROBORATION, not proof. A determined caller with a valid stores
 * session could synthesise a payload; nothing short of a signed scanner could
 * prevent that, and such a caller can already issue any real serial. What this
 * does eliminate is the accidental path — a mistyped serial silently becoming
 * permanent phantom stock — which is the failure this rule exists to prevent.
 *
 * Only a `box` payload qualifies. A single scanned serial is NOT enough: one
 * bare code carries nothing to cross-check, whereas a carton lists its
 * siblings and declares its own count.
 */
export function serialsEligibleForIntake(rawPayload: string | null | undefined): Set<string> {
  if (!rawPayload || typeof rawPayload !== 'string') return new Set();
  const parsed = parseScanPayload(rawPayload);
  if (parsed.kind !== 'box') return new Set();
  return new Set(parsed.serials);
}
