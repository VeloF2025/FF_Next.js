// Lives here, NOT in pages/field-ops/__tests__/, because anything under a
// non-API pages/ path is a real page route: `next build` collects page data for
// it, imports vitest outside its runner, and the build dies with "Vitest failed
// to access its internal state". Test files under pages/api/** are fine (47 of
// them today) — API routes are not page-data-collected. Page-component tests
// belong under src/, importing the page by relative path.
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRouter } from 'next/router';
import ZonePage from '../../../../../pages/field-ops/zone';

vi.mock('next/router', () => ({ useRouter: vi.fn() }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/module-page', () => ({
  ModulePage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/modules/construction-qa/zone-delivery/components/ZoneDeliveryWorkspacePage', () => ({
  ZoneDeliveryWorkspacePage: ({ zoneKey }: { zoneKey: { projectId: string; zoneNo: number } }) =>
    <p>Workspace {zoneKey.projectId} zone {zoneKey.zoneNo}</p>,
}));

const routerMock = vi.mocked(useRouter);
const projectId = '11111111-1111-4111-8111-111111111111';
const router = (query: Record<string, string | string[]>, isReady = true) => ({
  isReady, query,
  route: '/field-ops/zone', pathname: '/field-ops/zone', asPath: '/field-ops/zone',
  basePath: '', push: vi.fn(), replace: vi.fn(), reload: vi.fn(), back: vi.fn(),
  prefetch: vi.fn(), beforePopState: vi.fn(), events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  isFallback: false, isLocaleDomain: false, isPreview: false,
});

beforeEach(() => {
  routerMock.mockReset();
});

describe('field ops zone static route', () => {
  it('waits for the Pages Router before rendering a workspace', () => {
    routerMock.mockReturnValue(router({}, false) as never);
    render(<ZonePage />);
    expect(screen.getByRole('status', { name: 'Loading zone link' })).toBeInTheDocument();
    expect(screen.queryByText(/Workspace/)).not.toBeInTheDocument();
  });

  it('accepts one UUID project_id and one positive integer zone_no', () => {
    routerMock.mockReturnValue(router({ project_id: projectId, zone_no: '12' }) as never);
    render(<ZonePage />);
    expect(screen.getByText(`Workspace ${projectId} zone 12`)).toBeInTheDocument();
  });

  it.each([
    [{ project_id: 'not-a-uuid', zone_no: '12' }],
    [{ project_id: projectId, zone_no: '0' }],
    [{ project_id: projectId, zone_no: '-1' }],
    [{ project_id: projectId, zone_no: '1.5' }],
    [{ project_id: [projectId, projectId], zone_no: '12' }],
    [{ project_id: projectId, zone_no: ['12', '12'] }],
  ])('rejects invalid or repeated query values without mounting the workspace', query => {
    routerMock.mockReturnValue(router(query) as never);
    render(<ZonePage />);
    expect(screen.getByRole('alert')).toHaveTextContent('This zone link is invalid.');
    expect(screen.getByRole('link', { name: 'Back to zone register' })).toHaveAttribute('href', '/field-ops');
    expect(screen.queryByText(/Workspace/)).not.toBeInTheDocument();
  });
});
