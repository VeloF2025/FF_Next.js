/**
 * extractScannedSerial — pull the bare serial out of a scanned barcode payload.
 *
 * Equipment serial labels (e.g. Nokia GPON ONT) encode the serial inside an
 * ISO/IEC 15434 "Format 06" envelope in their DataMatrix square, not as a bare
 * string. A decoded payload looks like:
 *
 *   [)>{RS}06{GS}1P3TN01414BA{GS}SALCLB4923FA8{RS}{EOT}
 *
 * where {RS}=0x1E, {GS}=0x1D, {EOT}=0x04 are control separators, and each field
 * starts with an ASC MH10.8.2 Data Identifier: `1P` = supplier part number,
 * `S` = serial number. Sending the whole blob to the serial lookup fails ("not
 * found"); we must extract the `S`-identified field first.
 *
 * Plain payloads (a bare serial from a 1D CODE_128 barcode, or a manually-typed
 * serial) have no envelope and are returned trimmed and unchanged.
 */

// ASC MH10.8.2 / ISO 15434 separators (GS/RS/EOT control chars — intentional).
// eslint-disable-next-line no-control-regex
const SEPARATORS = /[\x1d\x1e\x04]+/;
const FORMAT_ENVELOPE = '[)>';

export function extractScannedSerial(raw: string): string {
  const text = raw.trim();

  // Only attempt structured parsing when the ISO 15434 message header is present,
  // so a bare serial that merely happens to start with 'S' is never mangled.
  if (text.includes(FORMAT_ENVELOPE)) {
    const fields = text
      .split(SEPARATORS)
      .map((f) => f.trim())
      .filter(Boolean);

    // MH10 Data Identifier 'S' (bare) carries the serial number. Multi-character
    // DIs are digit-prefixed (1P, 3S, …), so a field starting with 'S' followed
    // by an alphanumeric is the serial field; its value is the remainder.
    const serialField = fields.find((f) => /^S[0-9A-Za-z]/.test(f));
    if (serialField) {
      return serialField.slice(1);
    }
  }

  return text;
}
