import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { SnagReportsPage } from '../SnagReportsPage';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [], pagination: { total: 0, page: 1, pageSize: 20 } }),
  });
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

describe('SnagReportsPage source filter', () => {
  it('renders all 4 source chips (All / TQR / Works QA / Scoped)', async () => {
    render(<SnagReportsPage projectId="p1" />, { wrapper });
    expect(await screen.findByRole('button', { name: /^All$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^TQR$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Works QA/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scoped/i })).toBeInTheDocument();
  });

  it('passes source=scope query param when Scoped chip clicked', async () => {
    render(<SnagReportsPage projectId="p1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Scoped/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(c => String(c[0]));
      expect(calls.some(u => u.includes('source=scope'))).toBe(true);
    });
  });

  it('renders ScopeReportCard for source=scope rows with scope summary + PDF/Excel links', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 'r1', source: 'scope', report_number: 'SCOPE-LAWL-20260520-001',
          scope: 'zone', scope_zone_no: 24, scope_pon_no: null, scope_poles: null,
          scope_from_date: '2026-04-20', scope_to_date: '2026-05-20',
          pdf_url: 'https://x/r.pdf', project_name: 'Lawley', total_findings: 7,
          audit_date: '2026-05-20', generated_at: '2026-05-20T02:30:00Z',
        }],
        pagination: { total: 1, page: 1, pageSize: 20 },
      }),
    });
    render(<SnagReportsPage projectId="p1" />, { wrapper });
    expect(await screen.findByText(/SCOPE-LAWL-20260520-001/)).toBeInTheDocument();
    expect(screen.getByText(/Zone 24/)).toBeInTheDocument();
    expect(screen.getByText(/2026-04-20.*2026-05-20/)).toBeInTheDocument();
    const pdfLink = screen.getByRole('link', { name: /Open PDF/i });
    expect(pdfLink).toHaveAttribute('href', 'https://x/r.pdf');
    const xlsxLink = screen.getByRole('link', { name: /Excel/i });
    expect(xlsxLink).toHaveAttribute('href', '/api/snags/reports-scope-xlsx?id=r1');
  });
});
