import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  options: vi.fn(), roster: vi.fn(), listSites: vi.fn(), update: vi.fn(), history: vi.fn(),
}));
const permissions = vi.hoisted(() => ({ canEditRules: false }));

vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/module-page', () => ({ ModulePage: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/modules/navigation', () => ({ fleetConfig: {} }));
vi.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: Object.fromEntries(new URLSearchParams(window.location.search)) }) }));
vi.mock('@/modules/fleet/assignments/web/assignmentApi', () => ({ assignmentApi: api }));
vi.mock('@/modules/fleet/assignments/web/AssignmentEditor', () => ({
  AssignmentEditor: ({ initialStaffId, projectId, from, to }: { initialStaffId?: string; projectId: string; from: string; to: string }) =>
    <output aria-label="Assignment editor state">{[initialStaffId, projectId, from, to].join('|')}</output>,
}));
vi.mock('@/modules/fleet/assignments/web/ProjectSiteManager', () => ({ ProjectSiteManager: () => null }));
vi.mock('@/modules/fleet/assignments/web/ConflictReview', () => ({ ConflictReview: () => null }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (key: string, action: string) => key === 'fleet.operations-rules' && action === 'edit' && permissions.canEditRules, isLoading: false }) }));
vi.mock('@/modules/fleet/operations/web/StatusRulesDialog', () => ({ StatusRulesDialog: () => null }));
vi.mock('@/modules/fleet/assignments/web/AssignmentFilters', () => ({
  AssignmentFilters: ({ onChange }: { onChange: (value: Record<string, unknown>) => void }) =>
    <button onClick={() => onChange({ from: '2026-08-17', to: '2026-08-21', projectId: 'project-1', siteId: 'site-1', source: '', unassignedScheduled: false })}>Choose project</button>,
}));
vi.mock('@/modules/fleet/assignments/web/AssignmentRoster', () => ({
  AssignmentRoster: ({ rows, selected, onSelect }: { rows: Array<{ assignmentId: string | null; staffName: string }>; selected: string[]; onSelect: (ids: string[]) => void }) =>
    <>{rows.map((row) => <button key={row.staffName} aria-pressed={selected.includes(row.assignmentId!)} onClick={() => onSelect([row.assignmentId!])}>Select {row.staffName}</button>)}</>,
}));

import AssignmentPage from '../../../../../../pages/fleet/assignments/index';

const assignment = {
  assignmentId: 'assignment-1', staffId: 'staff-1', staffName: 'Driver One', projectId: 'project-1', projectName: 'Project One',
  operationalSiteId: 'site-1', operationalSiteName: 'Site One', startDate: '2026-08-17', endDate: '2026-08-21',
  assignmentKind: 'roster' as const, vehicleAssignmentId: 'vehicle-assignment-1', vehicleRegistration: 'TRK-1',
};

async function selectAssignment() {
  render(<AssignmentPage />);
  fireEvent.click(screen.getByText('Choose project'));
  fireEvent.click(await screen.findByText('Select Driver One'));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/fleet/assignments');
  permissions.canEditRules = false;
  api.options.mockResolvedValue({ staff: [], teams: [], projects: [], sites: [{ id: 'site-1', label: 'Site One', projectId: 'project-1' }, { id: 'site-2', label: 'Site Two', projectId: 'project-1' }], vehicles: [], siteSources: [] });
  api.roster.mockResolvedValue({ items: [assignment], total: 1 });
  api.listSites.mockResolvedValue([]);
  api.update.mockResolvedValue({});
  api.history.mockResolvedValue([{ action: 'moved', reason: 'Coverage change' }]);
});

describe('AssignmentPage manager actions', () => {
  it('hides Status Rules from users without rule edit permission', () => {
    render(<AssignmentPage />);
    expect(screen.queryByRole('button', { name: 'Status Rules' })).not.toBeInTheDocument();
  });

  it('shows Status Rules to users with rule edit permission', () => {
    permissions.canEditRules = true; render(<AssignmentPage />);
    expect(screen.getByRole('button', { name: 'Status Rules' })).toBeInTheDocument();
  });

  it('moves a roster assignment with the manager-entered reason and coverage dates', async () => {
    await selectAssignment();
    fireEvent.change(screen.getByLabelText('Assignment action start date'), { target: { value: '2026-08-19' } });
    fireEvent.change(screen.getByLabelText('Move end date'), { target: { value: '2026-08-22' } });
    fireEvent.change(screen.getByLabelText('Move destination site'), { target: { value: 'site-2' } });
    fireEvent.change(screen.getByLabelText('Assignment action reason'), { target: { value: '  Coverage change  ' } });
    await act(async () => { fireEvent.click(screen.getByText('Move selected')); });

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('assignment-1', {
      action: 'replace', staffId: 'staff-1', projectId: 'project-1', operationalSiteId: 'site-2',
      startDate: '2026-08-19', endDate: '2026-08-22', assignmentKind: 'roster',
      vehicleAssignmentId: 'vehicle-assignment-1', reason: 'Coverage change',
    }));
  });

  it('ends the selected assignment with the manager-entered reason and date', async () => {
    await selectAssignment();
    fireEvent.change(screen.getByLabelText('Assignment action start date'), { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByLabelText('Assignment action reason'), { target: { value: '  Work completed  ' } });
    await act(async () => { fireEvent.click(screen.getByText('End selected')); });

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('assignment-1', {
      action: 'end', endDate: '2026-08-20', reason: 'Work completed',
    }));
  });

  it('loads and displays assignment history for the selected row', async () => {
    await selectAssignment();
    await act(async () => { fireEvent.click(screen.getByText('View history')); });

    expect(await screen.findByLabelText('Assignment history')).toHaveTextContent('Coverage change');
    expect(api.history).toHaveBeenCalledWith('assignment-1');
  });

  it('initializes the project, work date, staff query, and intended assignment from a dashboard deep link', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const staffId = '22222222-2222-4222-8222-222222222222';
    const assignmentId = '33333333-3333-4333-8333-333333333333';
    window.history.replaceState({}, '', `/fleet/assignments?projectId=${projectId}&staffId=${staffId}&workDate=2026-08-13`);
    api.roster.mockResolvedValue({ items: [{ ...assignment, assignmentId, projectId, staffId }], total: 1 });

    render(<AssignmentPage />);

    const row = await screen.findByRole('button', { name: 'Select Driver One' });
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(api.roster).toHaveBeenCalledWith(expect.stringContaining(`projectId=${projectId}`));
    expect(api.roster).toHaveBeenCalledWith(expect.stringContaining(`staffId=${staffId}`));
    expect(api.roster).toHaveBeenCalledWith(expect.stringContaining('from=2026-08-13'));
    expect(api.roster).toHaveBeenCalledWith(expect.stringContaining('to=2026-08-13'));
  });

  it('renders stable server defaults before hydrating a dashboard deep link', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const staffId = '22222222-2222-4222-8222-222222222222';
    window.history.replaceState({}, '', `/fleet/assignments?projectId=${projectId}&staffId=${staffId}&workDate=2026-08-13`);
    api.roster.mockResolvedValue({ items: [{ ...assignment, assignmentId: '33333333-3333-4333-8333-333333333333', projectId, staffId }], total: 1 });

    const markup = renderToString(<AssignmentPage />);
    expect(markup).toContain('Select a project to load its roster.');
    const container = document.createElement('div'); container.innerHTML = markup; document.body.append(container);
    let root: Root | undefined;
    await act(async () => { root = hydrateRoot(container, <AssignmentPage />); });
    expect(await screen.findByRole('button', { name: 'Select Driver One' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => root?.unmount()); container.remove();
  });

  it.each(['vehicle_project', 'home_site', 'unassigned'] as const)('opens a %s derived row in an initialized editor', async (assignmentKind) => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const staffId = '22222222-2222-4222-8222-222222222222';
    window.history.replaceState({}, '', `/fleet/assignments?projectId=${projectId}&staffId=${staffId}&workDate=2026-08-13`);
    api.roster.mockResolvedValue({ items: [{ ...assignment, assignmentId: null, assignmentKind, projectId, staffId }], total: 1 });

    render(<AssignmentPage />);

    expect(await screen.findByLabelText('Assignment editor state')).toHaveTextContent(`${staffId}|${projectId}|2026-08-13|2026-08-13`);
    expect(await screen.findByRole('button', { name: 'Select Driver One' })).toHaveAttribute('aria-pressed', 'false');
  });
});
