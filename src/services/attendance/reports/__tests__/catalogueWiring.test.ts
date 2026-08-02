import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => React.createElement('main', null, children),
}));
vi.mock('@/components/attendance/AttendanceNav', () => ({ AttendanceNav: () => null }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));

import { ALL_REPORT_SLUGS, REPORT_CATALOGUE } from '../types';
import { isReportSlug, runReport } from '../runner';
import type { ReportInput } from '../types';
import ReportsIndexPage from '../../../../../pages/staff/attendance/reports';

describe('geofence-patterns slug is wired', () => {
  it('appears in ALL_REPORT_SLUGS', () => {
    expect(ALL_REPORT_SLUGS).toContain('geofence-patterns');
  });

  it('appears in REPORT_CATALOGUE with date_range + departments_text inputs', () => {
    const def = REPORT_CATALOGUE.find((r) => r.slug === 'geofence-patterns');
    expect(def).toBeDefined();
    expect(def!.title).toMatch(/archetype|pattern/i);
    const inputKinds = def!.inputs.map((i) => i.kind);
    expect(inputKinds).toContain('date_range');
    expect(inputKinds).toContain('departments_text');
  });

  it('isReportSlug recognises the new slug', () => {
    expect(isReportSlug('geofence-patterns')).toBe(true);
  });
});

describe('authoritative attendance reports are wired end to end', () => {
  it.each(['exception-ageing', 'payroll-readiness', 'evidence-quality'] as const)(
    'registers %s in catalogue and dispatcher',
    (slug) => {
      expect(ALL_REPORT_SLUGS).toContain(slug);
      expect(REPORT_CATALOGUE.find((item) => item.slug === slug)).toBeDefined();
      expect(isReportSlug(slug)).toBe(true);
    },
  );

  it('renders the three policy-backed reports without legacy lateness deferral copy', () => {
    const html = renderToStaticMarkup(React.createElement(ReportsIndexPage));
    expect(html).toContain('Exception ageing');
    expect(html).toContain('Payroll readiness');
    expect(html).toContain('Evidence quality');
    expect(html).not.toContain('Looking for late-arrivals?');
  });

  it.each(['exception-ageing', 'payroll-readiness', 'evidence-quality'] as const)(
    'preserves %s columns for screen and export when supervisor scope is empty',
    async (slug) => {
      const input: ReportInput = {
        scopedStaffIds: [], hasAnyStaff: false, scope: {} as ReportInput['scope'],
        dateFrom: '2026-07-01', dateTo: '2026-08-01', departments: [], siteIds: [], staffIdsHint: [],
      };
      const result = await runReport(slug, input, { id: 'supervisor-user', role: 'supervisor' } as never);
      expect(result.rows).toEqual([]);
      expect(result.columns.length).toBeGreaterThan(0);
      expect(result.notes).toContain('No staff in scope.');
    },
  );
});
