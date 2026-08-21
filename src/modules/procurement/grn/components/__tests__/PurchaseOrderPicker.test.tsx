/**
 * Interaction tests for the GRN purchase-order picker.
 *
 * These drive the real component with real events rather than asserting on a
 * static render: the incident was that a PO existed in the list but could not
 * be *found*, so what matters is what typing and clicking actually do.
 *
 * Fixtures mirror production rows read on 2026-08-21.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseOrderPicker } from '../PurchaseOrderPicker';
import type { PickerPurchaseOrder } from '../../lib/poPickerOptions';

afterEach(cleanup);

const po = (over: Partial<PickerPurchaseOrder> = {}): PickerPurchaseOrder => ({
  id: 'id-1',
  poNumber: 'PO-2026-0001',
  supplierName: 'Global Optic Cable SA',
  itemCount: 5,
  grnCount: 0,
  totalOrdered: 100,
  totalReceived: 0,
  ...over,
});

/** The incident PO: 7500 ordered, 800 received, 6700 outstanding. */
const INCIDENT = po({
  id: 'p237',
  poNumber: 'PO-2026-0237',
  supplierName: 'CABLE FEEDER SYSTEMS AFRICA CC',
  grnCount: 1,
  totalOrdered: 7500,
  totalReceived: 800,
});
const FULLY_RECEIVED = po({
  id: 'p235',
  poNumber: 'PO-2026-0235',
  grnCount: 1,
  totalOrdered: 5000,
  totalReceived: 5000,
});

/** 339 untouched POs — the pile that buried PO-2026-0237 at position 347. */
const BULK = Array.from({ length: 339 }, (_, i) =>
  po({ id: `bulk-${i}`, poNumber: `PO-2025-${3000 + i}`, supplierName: 'Misho ICT' })
);

function open(pos: PickerPurchaseOrder[], onSelect = vi.fn()) {
  const user = userEvent.setup();
  render(
    <PurchaseOrderPicker purchaseOrders={pos} selectedPOId="" onSelect={onSelect} />
  );
  return { user, onSelect };
}

describe('PurchaseOrderPicker', () => {
  it('lists the part-received PO first, ahead of 339 untouched ones', async () => {
    const { user } = open([...BULK, INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));

    const options = screen.getAllByRole('option');
    expect(within(options[0]!).getByText('PO-2026-0237')).toBeTruthy();
  });

  it('finds the PO by number when the user types it', async () => {
    const { user } = open([...BULK, INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), '0237');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(within(options[0]!).getByText('PO-2026-0237')).toBeTruthy();
  });

  it('finds POs by supplier name too', async () => {
    const { user } = open([...BULK, INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), 'cable feeder');

    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('shows the outstanding quantity so the user knows what is left', async () => {
    const { user } = open([INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));

    expect(screen.getByText('6700 outstanding')).toBeTruthy();
  });

  it('selects the PO on click and reports its id to the parent', async () => {
    const onSelect = vi.fn();
    const { user } = open([...BULK, INCIDENT], onSelect);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), '0237');
    await user.click(screen.getAllByRole('option')[0]!);

    expect(onSelect).toHaveBeenCalledWith('p237');
  });

  it('will not let a fully-received PO be selected', async () => {
    const onSelect = vi.fn();
    const { user } = open([FULLY_RECEIVED], onSelect);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));

    const option = screen.getAllByRole('option')[0]!;
    expect(within(option).getByText('Fully received')).toBeTruthy();
    await user.click(option);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tells the user when nothing matches instead of showing an empty box', async () => {
    const { user } = open([INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), 'zzzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No purchase order matches/i)).toBeTruthy();
  });

  it('can be cleared back to a standalone receipt', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PurchaseOrderPicker
        purchaseOrders={[INCIDENT]}
        selectedPOId="p237"
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByLabelText('Clear selected purchase order'));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('does not open at all when disabled by a pre-linked PO', async () => {
    const user = userEvent.setup();
    render(
      <PurchaseOrderPicker
        purchaseOrders={[INCIDENT]}
        selectedPOId=""
        onSelect={vi.fn()}
        disabled
      />
    );
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    expect(screen.queryByLabelText('Search purchase orders')).toBeNull();
  });
});
