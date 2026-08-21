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
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
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

/**
 * The listbox's first row is the standalone-receipt option — a real
 * role="option" so the keyboard can reach everything the mouse can. Tests that
 * care about purchase orders skip it rather than asserting on raw indices.
 */
function poOptions() {
  return screen
    .getAllByRole('option')
    .filter((o) => !o.textContent?.includes('standalone receipt'));
}

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

    expect(within(poOptions()[0]!).getByText('PO-2026-0237')).toBeTruthy();
  });

  it('finds the PO by number when the user types it', async () => {
    const { user } = open([...BULK, INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), '0237');

    const options = poOptions();
    expect(options).toHaveLength(1);
    expect(within(options[0]!).getByText('PO-2026-0237')).toBeTruthy();
  });

  it('finds POs by supplier name too', async () => {
    const { user } = open([...BULK, INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), 'cable feeder');

    expect(poOptions()).toHaveLength(1);
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
    await user.click(poOptions()[0]!);

    expect(onSelect).toHaveBeenCalledWith('p237');
  });

  it('will not let a fully-received PO be selected', async () => {
    const onSelect = vi.fn();
    const { user } = open([FULLY_RECEIVED], onSelect);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));

    const option = poOptions()[0]!;
    expect(within(option).getByText('Fully received')).toBeTruthy();
    await user.click(option);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tells the user when nothing matches instead of showing an empty box', async () => {
    const { user } = open([INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), 'zzzz');

    expect(poOptions()).toHaveLength(0);
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

  // ---- keyboard parity with the native <select> this replaced ----

  it('arrows to an option and chooses it with Enter — no mouse involved', async () => {
    const onSelect = vi.fn();
    const { user } = open([...BULK, INCIDENT], onSelect);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.type(screen.getByLabelText('Search purchase orders'), '0237');
    // First stop is the standalone-receipt row, second is the PO.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith('p237');
  });

  it('marks the arrowed-to option as the active descendant for screen readers', async () => {
    const { user } = open([INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    const input = screen.getByLabelText('Search purchase orders');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    await user.keyboard('{ArrowDown}');
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.getAttribute('role')).toBe('option');
  });

  it('wraps from the last option back to the first', async () => {
    const { user } = open([INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    const input = screen.getByLabelText('Search purchase orders');
    await user.keyboard('{ArrowDown}');
    const first = input.getAttribute('aria-activedescendant');
    // Two rows here: standalone + the PO. A third press wraps to the first.
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(first);
  });

  it('closes on Escape and returns focus to the trigger, not to <body>', async () => {
    const { user } = open([INCIDENT]);
    const trigger = screen.getByRole('button', { name: /standalone receipt/i });
    await user.click(trigger);
    expect(screen.getByLabelText('Search purchase orders')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Search purchase orders')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the trigger after choosing, so the form stays navigable', async () => {
    const { user } = open([INCIDENT]);
    const trigger = screen.getByRole('button', { name: /standalone receipt/i });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(document.activeElement).toBe(trigger);
  });

  it('refuses to choose a fully-received PO via the keyboard as well as the mouse', async () => {
    const onSelect = vi.fn();
    const { user } = open([FULLY_RECEIVED], onSelect);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    // Second stop is the fully-received PO; Enter on it must be refused.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('explains the refusal when a fully-received PO is clicked, rather than doing nothing', async () => {
    const onSelect = vi.fn();
    const { user } = open([FULLY_RECEIVED], onSelect);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.click(poOptions()[0]!);

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/PO-2026-0235 is fully received/i);
  });

  it('explains the refusal on Enter too, not just on click', async () => {
    const onSelect = vi.fn();
    const { user } = open([FULLY_RECEIVED], onSelect);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/fully received/i);
  });

  it('clears the refusal once the user searches again', async () => {
    const { user } = open([FULLY_RECEIVED, INCIDENT]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    await user.click(poOptions().find((o) => o.textContent?.includes('PO-2026-0235'))!);
    expect(screen.getByRole('status')).toBeTruthy();

    await user.type(screen.getByLabelText('Search purchase orders'), '0237');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no refusal message until the user actually tries a refused PO', async () => {
    const { user } = open([FULLY_RECEIVED]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a fully-received PO reachable so its state can be discovered', async () => {
    const { user } = open([FULLY_RECEIVED]);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));

    const option = screen.getAllByRole('option').find((o) => o.getAttribute('aria-disabled') === 'true');
    expect(option).toBeTruthy();
    expect(within(option!).getByText('Fully received')).toBeTruthy();
  });

  /**
   * Fires ONLY mousedown, deliberately.
   *
   * A full user.click() also moves focus, and the blur handler would close the
   * panel on its own — so the test would still pass with the outside-click
   * listener deleted, proving nothing. Dispatching the bare mousedown isolates
   * the document listener as the only thing that can close the panel.
   */
  it('closes when the user presses the mouse outside it', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <PurchaseOrderPicker purchaseOrders={[INCIDENT]} selectedPOId="" onSelect={vi.fn()} />
        <div data-testid="outside">elsewhere on the page</div>
      </div>
    );
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));
    expect(screen.getByLabelText('Search purchase orders')).toBeTruthy();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByLabelText('Search purchase orders')).toBeNull();
  });

  it('stays open when the mouse is pressed inside its own panel', async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderPicker purchaseOrders={[INCIDENT]} selectedPOId="" onSelect={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /standalone receipt/i }));

    fireEvent.mouseDown(screen.getByLabelText('Search purchase orders'));
    expect(screen.queryByLabelText('Search purchase orders')).toBeTruthy();
  });

  it('does not yank focus back to the trigger when the user clicks another field', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <PurchaseOrderPicker purchaseOrders={[INCIDENT]} selectedPOId="" onSelect={vi.fn()} />
        <button type="button">somewhere else on the form</button>
      </div>
    );
    const trigger = screen.getByRole('button', { name: /standalone receipt/i });
    await user.click(trigger);
    const elsewhere = screen.getByRole('button', { name: /somewhere else/i });
    await user.click(elsewhere);

    // The user asked to go elsewhere — stealing focus back would fight them.
    expect(document.activeElement).toBe(elsewhere);
    expect(document.activeElement).not.toBe(trigger);
  });

  it('forgets the previous search when reopened', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <PurchaseOrderPicker purchaseOrders={[INCIDENT]} selectedPOId="" onSelect={vi.fn()} />
        <div data-testid="outside">elsewhere on the page</div>
      </div>
    );
    const trigger = screen.getByRole('button', { name: /standalone receipt/i });
    await user.click(trigger);
    await user.type(screen.getByLabelText('Search purchase orders'), 'zzzz');
    await user.click(screen.getByTestId('outside'));
    await user.click(trigger);

    expect((screen.getByLabelText('Search purchase orders') as HTMLInputElement).value).toBe('');
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
