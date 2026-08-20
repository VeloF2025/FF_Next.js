/**
 * BoxGroupChip — one collapsible row standing for a whole scanned carton.
 *
 * The storeman must see at a glance how many of the box's serials are usable,
 * and be able to drop the whole box or one bad member.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoxGroupChip } from '../BoxGroupChip';
import type { PwaScannedSerial } from '../../types';

function member(over: Partial<PwaScannedSerial>): PwaScannedSerial {
  return {
    serialNumber: 'ALCLB49486FF', stockItemId: 'i', stockItemName: 'FT-ONT',
    scannedAt: 1, state: 'valid', groupId: 'g1', groupLabel: 'Box · 3 serials', ...over,
  };
}

const MEMBERS = [
  member({ serialNumber: 'ALCLB49486FF' }),
  member({
    serialNumber: 'ALCLB4948758',
    state: 'invalid',
    errorMessage: 'Serial is not available (status: issued)',
  }),
  member({ serialNumber: 'ALCLB4948779' }),
];

describe('BoxGroupChip', () => {
  it('summarises valid and rejected counts without expanding', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    expect(screen.getByText('Box · 3 serials')).toBeInTheDocument();
    expect(screen.getByText(/2 valid/)).toBeInTheDocument();
    expect(screen.getByText(/1 rejected/)).toBeInTheDocument();
    expect(screen.queryByText('ALCLB49486FF')).not.toBeInTheDocument();
  });

  it('omits the rejected count when the whole box is clean', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 2 serials"
        members={[MEMBERS[0]!, MEMBERS[2]!]} onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
  });

  it('lists the members once expanded', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Box · 3 serials/ }));
    expect(screen.getByText('ALCLB49486FF')).toBeInTheDocument();
    expect(screen.getByText('Serial is not available (status: issued)')).toBeInTheDocument();
  });

  it('removes the whole box', () => {
    const onRemoveGroup = vi.fn();
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={onRemoveGroup} onRemoveMember={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove this box' }));
    expect(onRemoveGroup).toHaveBeenCalledWith('g1');
  });

  it('removes one bad member without touching the rest', () => {
    const onRemoveMember = vi.fn();
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={vi.fn()} onRemoveMember={onRemoveMember} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Box · 3 serials/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove ALCLB4948758' }));
    expect(onRemoveMember).toHaveBeenCalledWith('ALCLB4948758');
  });

  it('shows a pending count while the batch call is in flight', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 2 serials"
        members={[
          member({ state: 'pending-validation' }),
          member({ serialNumber: 'ALCLB4948758', state: 'pending-validation' }),
        ]}
        onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });
});
