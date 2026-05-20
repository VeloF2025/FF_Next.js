import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { SnagReportScopeDialog } from '../SnagReportScopeDialog';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  // Default zone-pon-options response
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('zone-pon-options')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { zones: [24], pons: [{ zone_no: 24, pon_no: 265 }] } }),
      });
    }
    return Promise.resolve({ ok: false, json: async () => ({ error: 'unhandled' }) });
  });
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

describe('SnagReportScopeDialog', () => {
  it('renders with role=dialog and aria-modal', () => {
    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={() => {}} />, { wrapper });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <SnagReportScopeDialog open={false} projectId="p1" defaultCtx={{}} onClose={() => {}} />,
      { wrapper },
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{}} onClose={onClose} />, { wrapper });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('submits to /api/snags/reports-scope on Generate click', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('zone-pon-options')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { zones: [24], pons: [] } }) });
      }
      if (typeof url === 'string' && url.includes('reports-scope')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'r1', report_number: 'SCOPE-LAWL-20260520-001', pdf_url: 'https://x/r.pdf' } }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unhandled' }) });
    });

    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(c => String(c[0]));
      expect(calls.some(u => u.includes('/api/snags/reports-scope'))).toBe(true);
    });
  });

  it('shows confirmation panel with report_number and Open PDF / Excel links on success', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('zone-pon-options')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { zones: [24], pons: [] } }) });
      }
      if (typeof url === 'string' && url.includes('reports-scope')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'r1', report_number: 'SCOPE-LAWL-20260520-001', pdf_url: 'https://x/r.pdf' } }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => expect(screen.getByText(/SCOPE-LAWL-20260520-001/)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Open PDF/i })).toHaveAttribute('href', 'https://x/r.pdf');
    expect(screen.getByRole('link', { name: /Download Excel/i })).toHaveAttribute('href', '/api/snags/reports-scope-xlsx?id=r1');
  });

  it('renders inline error on HTTP failure', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('zone-pon-options')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { zones: [24], pons: [] } }) });
      }
      if (typeof url === 'string' && url.includes('reports-scope')) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ error: 'No snags match the requested scope' }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(screen.getByText(/No snags match/i)).toBeInTheDocument());
  });
});
