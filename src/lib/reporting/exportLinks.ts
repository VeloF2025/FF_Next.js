/**
 * Signed links for CSV report exports.
 *
 * A signed link is fetched WITHOUT a session — that is the point, so the URL can be
 * pasted into a browser or a spreadsheet's "import from web". Which means the caller's
 * access scope cannot come from a cookie at fetch time: it has to be decided when the
 * link is minted and carried inside the signature.
 *
 * So the signed parts include the minting user's email and whether they were the owner,
 * and the export route rebuilds the access rule from exactly those values. Editing the
 * email in the URL changes the canonical string and invalidates the signature, so a
 * holder cannot widen the scope — they can only fetch the slice the minter could see.
 *
 * What a leaked link DOES give away is that slice, to anyone holding it, until it
 * expires. That is the same trade already accepted for photo download links, and it is
 * why the TTL here is deliberately shorter than theirs: a CSV is a bulk extract of
 * meeting content, where a photo link is one image.
 */

import { signLink, verifyLink, type LinkVerdict } from '@/lib/photos/photoLinks';
import type { ActionItemAccess } from '@/lib/actionItems/meetingAccess';

/** Reports that can be exported. Anything not listed cannot be signed for. */
export const EXPORTABLE = ['action-items', 'meetings'] as const;
export type ExportReport = (typeof EXPORTABLE)[number];

export function isExportable(value: unknown): value is ExportReport {
  return typeof value === 'string' && (EXPORTABLE as readonly string[]).includes(value);
}

/**
 * Fifteen minutes.
 *
 * Long enough to click a link and let a spreadsheet fetch it, short enough that a URL
 * left in a chat thread or a browser history is dead by the time anyone finds it. The
 * photo links run an hour because a gigabyte-scale image pull needs it; a CSV is one
 * request.
 */
export const EXPORT_TTL_SECONDS = 15 * 60;

/**
 * The parts that are signed.
 *
 * `filters` is the serialised query, so a holder cannot broaden the result set by editing
 * a date or dropping a project filter — every filter is inside the signature too.
 */
function parts(
  report: ExportReport,
  access: ActionItemAccess,
  filters: string,
): Record<string, string | number> {
  return {
    purpose: 'report-csv',
    report,
    filters,
    // The scope. Not decoration — the export route rebuilds access from these.
    email: access.email,
    owner: access.isOwner ? 1 : 0,
  };
}

export function signExportLink(
  report: ExportReport,
  access: ActionItemAccess,
  filters: string,
): { exp: number; sig: string } | null {
  return signLink(parts(report, access, filters), EXPORT_TTL_SECONDS);
}

/**
 * Verify a presented link and return the access it was minted for.
 *
 * The access is RECONSTRUCTED from the signed values rather than read from the request,
 * so the scope the CSV is built with is the scope that was signed.
 */
export function verifyExportLink(
  report: ExportReport,
  email: string,
  owner: unknown,
  filters: string,
  exp: unknown,
  sig: unknown,
): { verdict: LinkVerdict; access?: ActionItemAccess } {
  // Coerced at the boundary rather than trusted. The parameter is typed `unknown` because
  // it arrives from a URL: `owner` was declared boolean while being consumed by
  // truthiness, so `'yes'` read as owner and `null` read as not-owner. Only the exact
  // value the minter signs counts as true, and anything else is narrowing.
  const isOwner = owner === true;
  const access: ActionItemAccess = {
    isOwner,
    email,
    // Deliberately empty. The user id arm of the action-item rule would need the minter's
    // uuid in the URL, and it only ever WIDENS what is visible; omitting it makes a link
    // slightly narrower than the page that minted it, which is the safe direction.
    userId: '',
  };
  return { verdict: verifyLink(parts(report, access, filters), exp, sig), access };
}
