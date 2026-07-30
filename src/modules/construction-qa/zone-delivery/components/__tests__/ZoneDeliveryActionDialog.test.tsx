import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ZoneDeliveryActionDialog } from '../ZoneDeliveryActionDialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open action</button>
      <ZoneDeliveryActionDialog
        open={open}
        title="Audit action"
        submitting={false}
        onClose={() => setOpen(false)}
        onSubmit={vi.fn().mockResolvedValue(true)}
      />
    </>
  );
}

describe('ZoneDeliveryActionDialog accessibility', () => {
  it('moves focus inside, closes on Escape, and restores trigger focus', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open action' });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByLabelText('Effective date and time')).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('wraps Tab and Shift+Tab within the dialog', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open action' }));
    const first = screen.getByLabelText('Effective date and time');
    const last = screen.getByRole('button', { name: 'Submit audited action' });
    await waitFor(() => expect(first).toHaveFocus());

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});
