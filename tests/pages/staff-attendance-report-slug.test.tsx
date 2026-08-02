/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  router: { isReady: true, query: { slug: 'payroll-readiness' } },
}));

vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={String(href)} {...props}>{children}</a>,
}));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/attendance/AttendanceNav', () => ({ AttendanceNav: () => <nav>Attendance</nav> }));
vi.mock('@/components/attendance/reports/ReportFilterBar', () => ({ ReportFilterBar: () => <div>Filters</div> }));
vi.mock('@/components/attendance/reports/ReportTable', () => ({ ReportTable: () => <div>Report table</div> }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import ReportSlugPage from '../../pages/staff/attendance/reports/[slug]';

function reportResponse(rows: Array<Record<string, unknown>> = []): Response {
  return {
    ok: true, status: 200,
    json: async () => ({
      success: true,
      data: {
        slug: 'payroll-readiness', rows,
        columns: [{ key: 'worker', label: 'Worker' }], notes: [], scopeNote: { kind: 'scoped', staffCount: 0 },
      },
    }),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('attendance report export controls', () => {
  it('enables header export for a successfully loaded zero-row report', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(reportResponse());
    render(<ReportSlugPage />);

    const csv = await screen.findByRole('button', { name: 'CSV' });
    await waitFor(() => expect(csv).toBeEnabled());
    expect(screen.getByRole('button', { name: 'XLSX' })).toBeEnabled();
  });

  it('keeps export disabled while loading and after an API error', async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const loading = render(<ReportSlugPage />);
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'XLSX' })).toBeDisabled();
    loading.unmount();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false, status: 500,
      json: async () => ({ success: false, error: { message: 'Report unavailable' } }),
    } as Response);
    render(<ReportSlugPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Report unavailable');
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'XLSX' })).toBeDisabled();
  });
});
