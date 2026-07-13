/**
 * Only allow same-origin relative paths as a post-login redirect target.
 * Guards router.push(returnUrl) against open-redirect to external hosts.
 */
export function safeReturnUrl(raw: string | string[] | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return '/';
  // Must start with a single slash and not be protocol-relative ("//host").
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  // Reject anything that smells like a scheme (e.g. "/\evil" backslash tricks).
  if (raw.includes('\\')) return '/';
  return raw;
}
