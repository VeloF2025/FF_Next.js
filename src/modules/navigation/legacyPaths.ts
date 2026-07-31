/**
 * Legacy URL prefixes that still serve canonical pages.
 *
 * Normally a legacy URL redirects and nothing downstream ever sees it. The
 * exception is `/projects/health-safety`, which must RENDER rather than
 * redirect: `/health-safety` used to 308 to it, browsers cache 308s
 * indefinitely, and redirecting back would bounce those clients until
 * ERR_TOO_MANY_REDIRECTS. See `pages/projects/health-safety/index.tsx`.
 *
 * The cost is that `usePathname()` resolves to the legacy string for those
 * clients, so anything matching a route against nav config silently fails to
 * match — the sidebar highlighted "Projects" and the module tab strip showed no
 * active tab, on a page visibly rendering the H&S dashboard.
 *
 * Canonicalising once here keeps that knowledge out of the generic matchers,
 * which should not need to know which modules have legacy aliases.
 */

/** [legacy prefix, canonical prefix] */
const LEGACY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['/projects/health-safety', '/health-safety'],
];

/**
 * Rewrites a legacy path to its canonical equivalent, preserving any
 * sub-path. Returns the input unchanged when no alias applies.
 *
 *   /projects/health-safety          -> /health-safety
 *   /projects/health-safety/training -> /health-safety/training
 *   /projects                        -> /projects   (untouched)
 */
export function canonicalizePath(pathname: string): string {
  for (const [legacy, canonical] of LEGACY_PREFIXES) {
    if (pathname === legacy) return canonical;
    if (pathname.startsWith(`${legacy}/`)) {
      return canonical + pathname.slice(legacy.length);
    }
  }
  return pathname;
}
