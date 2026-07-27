/**
 * Request-input normalisation shared by the H&S write endpoints.
 *
 * Exists because a validation guard and the SQL write that follows it must
 * operate on the SAME value. When the guard trims but the write binds the raw
 * input, a whitespace-only string slips past the guard ("looks empty") and
 * still reaches Postgres as a non-NULL value — turning what should be a 400
 * into a cast error or a CHECK violation, i.e. a 500.
 */

/**
 * `null` for anything the user meant as "empty": null, undefined, or a string
 * that is blank once trimmed. Otherwise the trimmed string.
 *
 * Normalise BEFORE validating, then bind the normalised value — never re-derive
 * it at the write site.
 */
export function blankToNull(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}
