/**
 * Request-input normalisation shared by the H&S write endpoints.
 *
 * `blankToNull` exists because a validation guard and the SQL write that
 * follows it must operate on the SAME value. When the guard trims but the write
 * binds the raw input, a whitespace-only string slips past the guard ("looks
 * empty") and still reaches Postgres as a non-NULL value — turning what should
 * be a 400 into a cast error or a CHECK violation, i.e. a 500.
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

/**
 * True when a stored document link is safe to render as an `href`.
 *
 * Rejects `javascript:`, `data:` and every other scheme: a link is written by
 * anyone with H&S edit permission and clicked by anyone with view permission,
 * so an unchecked scheme is stored XSS against the reader's authenticated
 * session. `type="url"` on the input does not stop this (`javascript:alert(1)`
 * is a well-formed absolute URL) and a direct API call bypasses the form
 * entirely, so the check has to live server-side.
 *
 * Same-origin paths ("/storage/...") are allowed; protocol-relative ("//host")
 * is not, since its scheme is decided by the embedding page.
 */
export function isSafeDocumentUrl(url: string): boolean {
  const value = url.trim();
  if (value === '') return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/')) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
