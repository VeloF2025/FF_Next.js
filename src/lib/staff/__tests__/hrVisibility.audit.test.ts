/**
 * Hiding-audit for Slice B (field-worker HR-hiding, G2).
 *
 * Two layers:
 *  1. Surface coverage (always-on, hermetic) — every enumerated HR/attendance
 *     surface references a shared visibility helper, so no surface is silently
 *     missed or hand-rolls a drifting clause.
 *  2. Behavioural truth-table (DB-gated) — runs the *real* predicate SQL
 *     (built from the shared helpers) against a read-only VALUES virtual table.
 *     Zero mutation, safe on the shared DB; skips cleanly when no DB reachable.
 *     Proves the spec's audit: a technician/pending row is absent from HR
 *     surfaces; a technician/active row appears in attendance but not HR.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  hrEmployeePredicate,
  approvedAccountPredicate,
} from '../hrVisibilityFilters';

const ROOT = process.cwd();

// ── 1. Surface coverage ────────────────────────────────────────────────────
// Each surface must reference a shared helper (directly, or via the
// `accountStatusRef` arg threaded into reports/sqlHelpers.buildBaseWhere, or
// the canonical employmentEffectivePredicate which includes Rule P).
const HELPER_MARKERS = [
  'hrEmployeePredicate',
  'approvedAccountPredicate',
  'approvedAccountPredicateRef',
  'accountStatusRef',
  'employmentEffectivePredicate',
  'employmentStaffAlias',
];

const RULE_H_SURFACES = [
  'src/services/staff/staffGetService.ts',
  'src/services/staff/neon/statistics.ts',
  'src/services/staff/neon/queryBuilders.ts',
  'pages/api/staff/alerts.ts',
  'pages/api/staff/payslips/import.ts',
  'src/modules/payslips/staffMatcher.ts',
  'src/modules/payslips/services/previewImport.ts',
  'pages/api/departments/[id].ts',
  'pages/api/departments/[id]/report.ts',
  'pages/api/admin/users/provision-from-staff.ts',
  'src/modules/noc/services/teamService.ts',
];

const RULE_P_SURFACES = [
  'src/services/attendance/searchQueries.ts',
  'src/services/attendance/reports/sqlHelpers.ts',
  'src/services/attendance/reports/deptRollup.ts',
  'src/services/attendance/reports/wageCost.ts',
  'src/services/attendance/reports/otTrend.ts',
  'src/services/attendance/reports/monthlyTotals.ts',
  'src/services/attendance/reports/bceaPremium.ts',
  'src/services/attendance/reports/geoMismatch.ts',
  'src/services/attendance/reports/geofencePatterns.ts',
  'pages/api/staff/attendance-roster.ts',
  'pages/api/staff/attendance-pulse-signals.ts',
  'pages/api/staff/attendance-week.ts',
];

const RULE_P_DELEGATED_SURFACES = [{
  surface: 'pages/api/staff/attendance-export.ts',
  delegation: 'preparePayrollExport',
  authority: 'src/modules/attendance/workflow/payrollLockSnapshot.ts',
}];

describe('Slice B surface coverage', () => {
  it.each([...RULE_H_SURFACES, ...RULE_P_SURFACES])(
    '%s applies a shared visibility filter',
    (rel) => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const hit = HELPER_MARKERS.some((m) => src.includes(m));
      expect(hit, `${rel} does not reference any visibility helper`).toBe(true);
    }
  );

  it.each(RULE_P_DELEGATED_SURFACES)(
    '$surface delegates to a Rule P-filtered authority',
    ({ surface, delegation, authority }) => {
      const surfaceSource = fs.readFileSync(path.join(ROOT, surface), 'utf8');
      const authoritySource = fs.readFileSync(path.join(ROOT, authority), 'utf8');
      expect(surfaceSource).toContain(delegation);
      expect(
        HELPER_MARKERS.some((marker) => authoritySource.includes(marker)),
        `${authority} does not reference any visibility helper`,
      ).toBe(true);
    },
  );
});

// ── 2. Behavioural truth-table (opt-in, live predicate SQL) ─────────────────
// Reads the REAL .env.local connection (not the fake test URL vitest injects
// into process.env), so the audit exercises the live engine.
function loadDatabaseUrl(): string | null {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    const m = env.match(/^DATABASE_URL=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* no env file */
  }
  return process.env.DATABASE_URL ?? null;
}

const DB_URL = loadDatabaseUrl();
// OFF by default. This suite hits the live shared DB (read-only VALUES — zero
// mutation). It is opt-in so it can NEVER silently pass against the fake test
// URL vitest injects: when enabled it asserts-or-fails-loudly; otherwise it is
// honestly SKIPPED (not falsely green). The always-on fragment + surface
// coverage tests are the hermetic floor. Run locally with:
//   RUN_DB_AUDIT=1 npx vitest run src/lib/staff/__tests__/hrVisibility.audit.test.ts
const RUN_DB_AUDIT = !!DB_URL && process.env.RUN_DB_AUDIT === '1';

interface AuditRow {
  role: string | null;
  account_status: string | null;
  passes_hr: boolean;
  passes_attendance: boolean;
}

describe.skipIf(!RUN_DB_AUDIT)('Slice B hiding-audit (live predicate SQL)', () => {
  // pg is the real driver here (only @neondatabase/serverless is mocked).
  let pool: import('pg').Pool | null = null;
  let rows: AuditRow[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({
      connectionString: DB_URL!,
      max: 1,
      connectionTimeoutMillis: 5000,
      // Self-hosted Supabase on a private (Tailscale/localhost) network — SSL
      // is only used when the connection string opts in via sslmode=require.
      ssl: DB_URL!.includes('sslmode=require') ? { ca: process.env.PGSSLROOTCERT } : false,
    });
    // Build the WHERE predicates from the SAME helpers the surfaces use, then
    // evaluate them against synthetic rows — no real table is touched. No
    // try/catch: if the DB is unreachable (opt-in implies it must be), the
    // suite fails loudly rather than silently passing.
    const hr = hrEmployeePredicate('');
    const att = approvedAccountPredicate('');
    const text = `
      SELECT role, account_status,
             (${hr}) AS passes_hr,
             (${att}) AS passes_attendance
      FROM (VALUES
        ('technician', 'pending'),
        ('technician', 'active'),
        ('technician', 'suspended'),
        ('casual', 'pending'),
        ('casual', 'active'),
        ('manager', NULL),
        (NULL, 'active'),
        ('admin', 'Pending')
      ) AS t(role, account_status)
    `;
    const res = await pool.query<AuditRow>(text);
    rows = res.rows;
  }, 15000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  function find(role: string | null, status: string | null): AuditRow {
    const r = rows.find((x) => x.role === role && x.account_status === status);
    if (!r) throw new Error(`fixture row not found: ${role}/${status}`);
    return r;
  }

  it('evaluated every fixture row', () => {
    expect(rows.length).toBe(8);
  });

  it('technician/pending is hidden from HR AND attendance', () => {
    const r = find('technician', 'pending');
    expect(r.passes_hr).toBe(false);
    expect(r.passes_attendance).toBe(false);
  });

  it('technician/active is hidden from HR but visible in attendance', () => {
    const r = find('technician', 'active');
    expect(r.passes_hr).toBe(false);
    expect(r.passes_attendance).toBe(true);
  });

  it('technician/suspended is hidden from HR but visible in attendance (not pending)', () => {
    const r = find('technician', 'suspended');
    expect(r.passes_hr).toBe(false);
    expect(r.passes_attendance).toBe(true);
  });

  it('casual/pending and casual/active are hidden from HR', () => {
    expect(find('casual', 'pending').passes_hr).toBe(false);
    expect(find('casual', 'active').passes_hr).toBe(false);
    // approved casual still shows hours
    expect(find('casual', 'active').passes_attendance).toBe(true);
  });

  it('a real employee (manager / NULL account_status) is visible everywhere', () => {
    const r = find('manager', null);
    expect(r.passes_hr).toBe(true);
    expect(r.passes_attendance).toBe(true);
  });

  it('NULL-role legacy employee stays visible to HR', () => {
    expect(find(null, 'active').passes_hr).toBe(true);
  });

  it('mixed-case "Pending" is still hidden from attendance (LOWER)', () => {
    expect(find('admin', 'Pending').passes_attendance).toBe(false);
  });
});

// ── 3. Precedence guard — alerts.ts compliance counts ───────────────────────
// The two compliance COUNTs in alerts.ts had an unparenthesised
// `status='active' OR is_active=true`; ANDing Rule H without wrapping would bind
// as `status='active' OR (is_active=true AND <rule>)`, leaking active-status
// field workers. This pins the parenthesisation so a future reformat can't
// silently reintroduce the precedence leak.
describe('Slice B precedence guard (alerts.ts)', () => {
  const alerts = fs.readFileSync(path.join(ROOT, 'pages/api/staff/alerts.ts'), 'utf8');

  it('never AND-injects Rule H directly onto an unparenthesised OR', () => {
    expect(alerts).not.toMatch(
      /status = 'active' OR is_active = true\s*\$\{sql\.unsafe\('AND/
    );
  });

  it('wraps the OR disjunction before AND-ing in both compliance counts', () => {
    const wrapped = alerts.match(
      /\(status = 'active' OR is_active = true\)\s*\$\{sql\.unsafe\('AND/g
    ) || [];
    expect(wrapped.length).toBeGreaterThanOrEqual(2);
  });
});
