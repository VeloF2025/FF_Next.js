/**
 * H&S RBAC ratchet (goal §4.8): every H&S API endpoint must be authorization-
 * gated, not merely authenticated. This static check fails if a new endpoint
 * ships with a bare `withAuth(handler)` (or no wrapper), the exact regression
 * class the phase closes.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const API_DIR = join(process.cwd(), 'pages/api/health-safety');
// The cron endpoint authenticates on x-cron-secret, not a user session.
const EXEMPT = new Set<string>([]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith('.ts') && !name.includes('.test.') ? [full] : [];
  });
}

describe('H&S API RBAC gates', () => {
  const files = walk(API_DIR);

  it('finds the H&S API endpoints', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('gates every endpoint with withHsPermission (not bare withAuth)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (EXEMPT.has(f)) continue;
      const src = readFileSync(f, 'utf8');
      const rel = f.slice(f.indexOf('pages/api'));
      // Must route through withHsPermission and must NOT export a bare withAuth.
      if (!/export default withHsPermission\(/.test(src)) offenders.push(`${rel} — missing withHsPermission`);
      if (/export default withAuth\(handler\)/.test(src)) offenders.push(`${rel} — bare withAuth`);
    }
    expect(offenders).toEqual([]);
  });
});
