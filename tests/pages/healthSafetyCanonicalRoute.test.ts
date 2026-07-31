/**
 * Pins which H&S URL is canonical.
 *
 * This module has produced a circular redirect once already
 * (`.claude/learnings.md`, "Circular Redirect Detection"), and the direction
 * was reversed a second time when H&S was promoted out of Projects. Nothing in
 * CI asserted which side is canonical, so both incidents were invisible until
 * a human hit the loop.
 *
 * The rule: `/health-safety/*` is canonical. `/projects/health-safety/*` is
 * legacy and may only ever point AT it — never the reverse.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CANONICAL = join(process.cwd(), 'pages/health-safety');
const LEGACY = join(process.cwd(), 'pages/projects/health-safety');

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Redirect destinations declared in a page, if any. */
function destinations(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/destination:\s*[`'"]([^`'"]+)/g)].map((m) => m[1] as string);
}

describe('health & safety canonical route', () => {
  it('serves the dashboard at /health-safety rather than redirecting away', () => {
    const dests = destinations(join(CANONICAL, 'index.tsx'));
    expect(dests).toEqual([]);
  });

  it('never redirects a canonical page back to the legacy /projects tree', () => {
    const offenders = pageFiles(CANONICAL)
      .filter((f) => destinations(f).some((d) => d.startsWith('/projects/health-safety')));
    expect(offenders).toEqual([]);
  });

  it('keeps every legacy redirect pointing at the canonical tree', () => {
    const offenders = pageFiles(LEGACY)
      .flatMap((f) => destinations(f).map((d) => ({ f, d })))
      .filter(({ d }) => !d.startsWith('/health-safety'));
    expect(offenders).toEqual([]);
  });

  it('does not redirect the legacy root, because a cached 308 would loop', () => {
    // /health-safety used to 308 to /projects/health-safety. That is cached in
    // browsers indefinitely, so if this path redirected back, those clients
    // would bounce between the two until ERR_TOO_MANY_REDIRECTS. It must serve
    // content instead.
    expect(destinations(join(LEGACY, 'index.tsx'))).toEqual([]);
  });

  it('carries the id through the legacy CAPA detail redirect', () => {
    const src = readFileSync(join(LEGACY, 'capa/[id].tsx'), 'utf8');
    // A bare `/health-safety/capa` would silently drop which CAPA was asked for.
    expect(src).toMatch(/\/health-safety\/capa\/\$\{/);
  });
});
