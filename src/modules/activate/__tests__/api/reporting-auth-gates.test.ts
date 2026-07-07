/**
 * Auth-gate ratchet for /api/activate/reporting/*.
 *
 * These endpoints must be gated by the DB-backed RBAC
 * (withPermission('activate.reports', …)) so that grants made in
 * Settings → Access Control actually take effect. A hardcoded
 * withRole('manager') gate ignores role_permissions /
 * user_permission_overrides entirely — admins grant a viewer access,
 * the grant persists, and the API still 403s (Hartwig, 2026-07-07).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPORTING_DIR = join(process.cwd(), 'pages/api/activate/reporting');

// Endpoints intentionally NOT on the activate.reports permission gate.
const EXCEPTIONS: Record<string, RegExp> = {
  // Ticket creation is an action against NOC, not report viewing.
  'serial-mismatches/create-ticket.ts': /withRole\('technician'\)/,
  // Internal VLM accuracy stats — session-only by design.
  'vlm-accuracy.ts': /withAuth\(handler\)/,
};

function collectEndpointFiles(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...collectEndpointFiles(full, rel));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(rel);
    }
  }
  return files;
}

describe('activate reporting auth gates', () => {
  const endpoints = collectEndpointFiles(REPORTING_DIR);

  it('finds the reporting endpoints', () => {
    expect(endpoints.length).toBeGreaterThanOrEqual(19);
  });

  for (const rel of endpoints) {
    const source = readFileSync(join(REPORTING_DIR, rel), 'utf8');
    const exception = EXCEPTIONS[rel];

    if (exception) {
      it(`${rel} keeps its documented exception gate`, () => {
        expect(source).toMatch(exception);
      });
      continue;
    }

    it(`${rel} is gated by withPermission('activate.reports', …)`, () => {
      expect(source).toMatch(/withPermission\('activate\.reports', '(view|edit)'\)/);
      expect(source).not.toMatch(/withRole\(/);
    });
  }

  it('mutation endpoints require the edit action', () => {
    for (const rel of [
      'serial-swaps/update-status.ts',
      'serial-mismatches/update-status.ts',
    ]) {
      const source = readFileSync(join(REPORTING_DIR, rel), 'utf8');
      expect(source).toMatch(/withPermission\('activate\.reports', 'edit'\)/);
    }
  });
});
