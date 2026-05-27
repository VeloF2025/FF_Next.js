import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { SnagReportButton } from '../SnagReportButton';

// SnagReportButton renders the SnagReportScopeDialog internally — silence fetch
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { zones: [], pons: [] } }),
  }) as unknown as typeof fetch;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

describe('SnagReportButton context-aware label', () => {
  it('"Zone report" when only zone_no set', () => {
    render(<SnagReportButton projectId="p1" ctx={{ zone_no: 24 }} />, { wrapper });
    expect(screen.getByRole('button', { name: /Zone report/ })).toBeInTheDocument();
  });

  it('"PON report" when pon_no set', () => {
    render(<SnagReportButton projectId="p1" ctx={{ zone_no: 24, pon_no: 265 }} />, { wrapper });
    expect(screen.getByRole('button', { name: /PON report/ })).toBeInTheDocument();
  });

  it('"Pole report" when pole_id set', () => {
    render(<SnagReportButton projectId="p1" ctx={{ pole_id: 'LAW.P.X001' }} />, { wrapper });
    expect(screen.getByRole('button', { name: /Pole report/ })).toBeInTheDocument();
  });

  it('"Project report" when ctx empty', () => {
    render(<SnagReportButton projectId="p1" ctx={{}} />, { wrapper });
    expect(screen.getByRole('button', { name: /Project report/ })).toBeInTheDocument();
  });

  it('clicking the main button opens the dialog', () => {
    render(<SnagReportButton projectId="p1" ctx={{ zone_no: 24 }} />, { wrapper });
    // Dialog not open by default
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Zone report/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clicking Advanced caret also opens the dialog', () => {
    render(<SnagReportButton projectId="p1" ctx={{ zone_no: 24 }} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
