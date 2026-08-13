import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentRoster } from '../AssignmentRoster';
describe('AssignmentRoster', () => { it('supports bulk selection and no-vehicle rows', () => { const onSelect = vi.fn(); render(<AssignmentRoster rows={[{ assignmentId: 'a', staffId: 's', projectId: 'p', operationalSiteId: 'o', source: 'roster', startDate: '2026-08-12', endDate: '2026-08-12', vehicleAssignmentId: null }]} selected={[]} onSelect={onSelect} />); expect(screen.getByText('No vehicle')).toBeInTheDocument(); fireEvent.click(screen.getByLabelText('Select s')); expect(onSelect).toHaveBeenCalledWith(['a']); }); });
