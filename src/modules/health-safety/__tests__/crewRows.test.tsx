/**
 * CrewRows — the per-worker row editor.
 *
 * Two behaviours carry the data integrity of a crew submission:
 *  - picking a registered worker locks the name field, so the stored
 *    worker_name can never quietly diverge from the person the id points to;
 *  - a roster member already used by one row is not offered to the others,
 *    so one person cannot be linked twice in a single submission.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CrewRows, type CrewRowValue } from '../components/checkin/CrewRows';

const roster = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Thabo M', contractor_id: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Sipho D', contractor_id: null },
];

function rowsFixture(): CrewRowValue[] {
  return [
    { key: 1, name: '', teamMemberId: null, fit: true },
    { key: 2, name: '', teamMemberId: null, fit: true },
  ];
}

describe('CrewRows', () => {
  it('locks the name to the register when a member is picked, and unlocks on clear', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CrewRows rows={rowsFixture()} roster={roster} onChange={onChange} />
    );

    fireEvent.change(screen.getByLabelText('Registered worker for crew member 1'), {
      target: { value: roster[0].id },
    });
    const linked = onChange.mock.calls[0][0] as CrewRowValue[];
    expect(linked[0]).toMatchObject({ teamMemberId: roster[0].id, name: 'Thabo M' });

    rerender(<CrewRows rows={linked} roster={roster} onChange={onChange} />);
    const nameInput = screen.getByLabelText('Name of crew member 1') as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);

    fireEvent.change(screen.getByLabelText('Registered worker for crew member 1'), {
      target: { value: '' },
    });
    const unlinked = onChange.mock.calls[1][0] as CrewRowValue[];
    expect(unlinked[0].teamMemberId).toBeNull();
  });

  it('does not offer a roster member already linked to another row', () => {
    const rows = rowsFixture();
    rows[0] = { ...rows[0], teamMemberId: roster[0].id, name: 'Thabo M' };
    render(<CrewRows rows={rows} roster={roster} onChange={() => {}} />);

    const secondSelect = screen.getByLabelText('Registered worker for crew member 2');
    const options = within(secondSelect).getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('Thabo M');
    expect(options).toContain('Sipho D');
  });

  it('submits unfit as an explicit choice: unticking fit shows the not-cleared warning', () => {
    const onChange = vi.fn();
    const rows = [{ key: 1, name: 'Anna K', teamMemberId: null, fit: true }];
    const { rerender } = render(<CrewRows rows={rows} roster={[]} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(/Fit for duty today/i, { selector: 'input' }));
    const changed = onChange.mock.calls[0][0] as CrewRowValue[];
    expect(changed[0].fit).toBe(false);

    rerender(<CrewRows rows={changed} roster={[]} onChange={onChange} />);
    expect(screen.getByText(/will not be cleared to start/i)).toBeInTheDocument();
  });
});
