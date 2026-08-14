/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FleetDashboardPage from '../../../../../../pages/fleet';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/module-page', () => ({
  ModulePage: ({ children, headerActions }: { children: React.ReactNode; headerActions: React.ReactNode }) => <><div>{headerActions}</div>{children}</>,
}));
vi.mock('@/components/dashboard/EnhancedStatCard', () => ({
  StatsGrid: ({ cards }: { cards: Array<{ title: string }> }) => <section data-testid="legacy-stats">{cards.map((card) => <h2 key={card.title}>{card.title}</h2>)}</section>,
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));

function response(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/fleet');
  global.fetch = vi.fn((input) => {
    const url = String(input);
    if (url.startsWith('/api/fleet/vehicles')) return Promise.resolve(response(true, 200, { data: [{ id: 'v1', status: 'active' }] }));
    if (url === '/api/fleet/locations') return Promise.resolve(response(true, 200, { data: [{ id: 'l1' }] }));
    if (url.startsWith('/api/fleet/investigation')) return Promise.resolve(response(true, 200, { data: [] }));
    if (url.startsWith('/api/fleet/assignments/options')) return Promise.resolve(response(true, 200, { success: true, data: { staff: [], teams: [], projects: [{ id: PROJECT_ID, label: 'Lawley' }], sites: [], vehicles: [], siteSources: [] } }));
    if (url.startsWith('/api/fleet/operations/overview')) return Promise.resolve(response(false, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Operations unavailable' } }));
    throw new Error(`Unexpected request: ${url}`);
  });
});

describe('Fleet dashboard operational isolation', () => {
  it('keeps every existing section and action when operational loading fails', async () => {
    render(<FleetDashboardPage />);

    const stats = await screen.findByTestId('legacy-stats');
    for (const title of ['Total Vehicles', 'Active Vehicles', 'Unassigned', 'Authorized Locations']) {
      expect(within(stats).getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Recent Investigations' })).toBeInTheDocument();
    for (const action of ['Manage Vehicles', 'Authorized Locations', 'GPS Investigation']) {
      expect(screen.getByRole('heading', { name: action, level: 3 })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /All Vehicles/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Investigation/ })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Operational data could not be refreshed.');

    const operations = screen.getByRole('region', { name: "Today's Operations" });
    expect(stats.compareDocumentPosition(operations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/overview'))).toBe(true));
  });
});
