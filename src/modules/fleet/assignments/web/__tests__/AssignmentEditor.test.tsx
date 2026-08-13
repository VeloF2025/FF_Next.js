import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentEditor } from '../AssignmentEditor';
import { assignmentApi } from '../assignmentApi';
vi.mock('../assignmentApi', async () => { const actual = await vi.importActual<typeof import('../assignmentApi')>('../assignmentApi'); return { ...actual, assignmentApi: { preview: vi.fn(), commit: vi.fn() } }; });
const row = { staffId: '1', projectId: '2', operationalSiteId: '3', startDate: '2026-08-12', endDate: '2026-08-12', assignmentKind: 'roster' as const, vehicleAssignmentId: null, reason: null };
describe('AssignmentEditor', () => {
  it('previews before commit and refreshes only after success', async () => { const refresh = vi.fn(); vi.mocked(assignmentApi.preview).mockResolvedValue({ normalizedRows: [row], conflicts: [], fingerprint: 'x', sourceVersion: 'v', excludedStaffIds: [] }); vi.mocked(assignmentApi.commit).mockResolvedValue({ batchId: 'b' }); render(<AssignmentEditor rows={[row]} onCommitted={refresh} />); fireEvent.click(screen.getByText('Preview assignments')); await screen.findByText('Commit assignments'); expect(assignmentApi.commit).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Commit assignments')); await waitFor(() => expect(refresh).toHaveBeenCalled()); });
  it('requires warning confirmation and disables blocking commits', async () => { vi.mocked(assignmentApi.preview).mockResolvedValue({ normalizedRows: [row], conflicts: [{ rowIndex: 0, code: 'x', level: 'warning', field: null, message: 'Review' }], fingerprint: 'x', sourceVersion: 'v', excludedStaffIds: [] }); render(<AssignmentEditor rows={[row]} onCommitted={vi.fn()} />); fireEvent.click(screen.getByText('Preview assignments')); const commit = await screen.findByText('Commit assignments'); expect(commit).toBeDisabled(); fireEvent.click(screen.getByLabelText(/Confirm warnings/)); expect(commit).toBeEnabled(); });
});
