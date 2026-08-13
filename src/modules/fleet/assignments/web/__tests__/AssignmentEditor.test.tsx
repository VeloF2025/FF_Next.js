import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentEditor } from '../AssignmentEditor';
import { assignmentApi } from '../assignmentApi';
vi.mock('../assignmentApi', async () => { const actual = await vi.importActual<typeof import('../assignmentApi')>('../assignmentApi'); return { ...actual, assignmentApi: { preview: vi.fn(), commit: vi.fn() } }; });
const row = { staffId: '1', projectId: '2', operationalSiteId: '3', startDate: '2026-08-12', endDate: '2026-08-12', assignmentKind: 'roster' as const, vehicleAssignmentId: null, reason: null };
describe('AssignmentEditor', () => {
  const options = { staff: [{ id: '1', label: 'Driver' }], teams: [], projects: [], sites: [], vehicles: [], siteSources: [] };
  const setup = (refresh = vi.fn()) => { render(<AssignmentEditor options={options} projectId="2" siteId="3" from="2026-08-12" to="2026-08-12" onCommitted={refresh} />); fireEvent.click(screen.getByLabelText('Driver')); return refresh; };
  it('previews before commit and refreshes only after success', async () => { const refresh = setup(); vi.mocked(assignmentApi.preview).mockResolvedValue({ normalizedRows: [row], conflicts: [], fingerprint: 'x', sourceVersion: 'v', excludedStaffIds: [] }); vi.mocked(assignmentApi.commit).mockResolvedValue({ batchId: 'b' }); fireEvent.click(screen.getByText('Preview assignments')); await screen.findByText('Commit assignments'); expect(assignmentApi.commit).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Commit assignments')); await waitFor(() => expect(refresh).toHaveBeenCalled()); });
  it('requires warning confirmation and disables blocking commits', async () => { setup(); vi.mocked(assignmentApi.preview).mockResolvedValue({ normalizedRows: [row], conflicts: [{ rowIndex: 0, code: 'x', level: 'warning', field: null, message: 'Review' }], fingerprint: 'x', sourceVersion: 'v', excludedStaffIds: [] }); fireEvent.click(screen.getByText('Preview assignments')); const commit = await screen.findByText('Commit assignments'); expect(commit).toBeDisabled(); fireEvent.click(screen.getByLabelText(/Confirm warnings/)); expect(commit).toBeEnabled(); });
  it('builds one row per person with an optional person-specific vehicle', async () => {
    const personOptions = { ...options, staff: [{ id: '1', label: 'Driver One' }, { id: '4', label: 'Driver Two' }], vehicles: [{ id: 'truck', label: 'TRK-1', vehicleAssignmentId: 'va-1', staffId: '1' }] };
    render(<AssignmentEditor options={personOptions} projectId="2" siteId="3" from="2026-08-12" to="2026-08-12" onCommitted={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Driver One')); fireEvent.click(screen.getByLabelText('Driver Two'));
    fireEvent.change(screen.getByLabelText('Vehicle for Driver One'), { target: { value: 'va-1' } });
    vi.mocked(assignmentApi.preview).mockResolvedValue({ normalizedRows: [], conflicts: [], fingerprint: 'x', sourceVersion: 'v', excludedStaffIds: [] });
    fireEvent.click(screen.getByText('Preview assignments'));
    await waitFor(() => expect(assignmentApi.preview).toHaveBeenCalledWith([
      expect.objectContaining({ staffId: '1', vehicleAssignmentId: 'va-1' }),
      expect.objectContaining({ staffId: '4', vehicleAssignmentId: null }),
    ], [], undefined));
    await screen.findByText('Commit assignments');
  });
});
