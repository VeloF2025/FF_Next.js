/**
 * Drives the real picker with real events. Fixtures include the 316-item
 * catalogue size and the specific items a clerk reported as missing when the
 * API capped the list at 100.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StockItemPicker } from '../StockItemPicker';
import type { SearchableStockItem } from '../../../lib/itemSearch';

afterEach(cleanup);

const SPLITTER: SearchableStockItem = { id: 'sp', itemCode: 'OPT-116BF', name: '1:16 Bare Fibre Splitter', category: 'optics', trackingType: 'quantity' };
const ONT: SearchableStockItem = { id: 'ont', itemCode: 'ACT-ONT', name: 'ONT Device', category: 'activations', trackingType: 'serial' };

/** 315 filler items so the list is production-sized, plus the splitter. */
const CATALOGUE: SearchableStockItem[] = [
  ...Array.from({ length: 315 }, (_, i) => ({
    id: `f${i}`,
    itemCode: `ACT-${i}`,
    name: `Activation consumable ${i}`,
    category: 'activations',
    trackingType: 'quantity',
  })),
  SPLITTER,
];

function open(items: SearchableStockItem[], onSelect = vi.fn()) {
  const user = userEvent.setup();
  render(<StockItemPicker instanceId="t" items={items} selectedItemId="" onSelect={onSelect} />);
  return { user, onSelect };
}

describe('StockItemPicker', () => {
  it('reaches the 316th item, which the old cap of 100 made unreachable', async () => {
    const { user } = open(CATALOGUE);
    await user.click(screen.getByRole('button', { name: /select item/i }));
    await user.type(screen.getByLabelText('Search stock items'), 'splitter');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(within(options[0]!).getByText(/1:16 Bare Fibre Splitter/)).toBeTruthy();
  });

  it('finds items by category as well as name', async () => {
    const { user } = open(CATALOGUE);
    await user.click(screen.getByRole('button', { name: /select item/i }));
    await user.type(screen.getByLabelText('Search stock items'), 'optics');

    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('reports the chosen item id to the parent on click', async () => {
    const { user, onSelect } = open(CATALOGUE);
    await user.click(screen.getByRole('button', { name: /select item/i }));
    await user.type(screen.getByLabelText('Search stock items'), 'splitter');
    await user.click(screen.getAllByRole('option')[0]!);

    expect(onSelect).toHaveBeenCalledWith('sp');
  });

  it('is fully operable by keyboard', async () => {
    const { user, onSelect } = open(CATALOGUE);
    await user.click(screen.getByRole('button', { name: /select item/i }));
    await user.type(screen.getByLabelText('Search stock items'), 'splitter');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith('sp');
  });

  it('returns focus to the trigger after choosing', async () => {
    const { user } = open([SPLITTER]);
    const trigger = screen.getByRole('button', { name: /select item/i });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape and restores focus', async () => {
    const { user } = open([SPLITTER]);
    const trigger = screen.getByRole('button', { name: /select item/i });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByLabelText('Search stock items')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the mouse is pressed outside it', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <StockItemPicker instanceId="t" items={[SPLITTER]} selectedItemId="" onSelect={vi.fn()} />
        <div data-testid="outside">elsewhere</div>
      </div>
    );
    await user.click(screen.getByRole('button', { name: /select item/i }));
    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(screen.queryByLabelText('Search stock items')).toBeNull();
  });

  it('flags serial-tracked items, which behave differently on a picking', async () => {
    const { user } = open([ONT]);
    await user.click(screen.getByRole('button', { name: /select item/i }));

    expect(screen.getByText(/serial-tracked/)).toBeTruthy();
  });

  it('says so when nothing matches instead of showing a blank list', async () => {
    const { user } = open([SPLITTER]);
    await user.click(screen.getByRole('button', { name: /select item/i }));
    await user.type(screen.getByLabelText('Search stock items'), 'zzzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No item matches/)).toBeTruthy();
  });

  it('shows the selected item on the closed trigger', () => {
    render(<StockItemPicker instanceId="t" items={[SPLITTER]} selectedItemId="sp" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /OPT-116BF - 1:16 Bare Fibre Splitter/ })).toBeTruthy();
  });

  it('binds an existing <label htmlFor> via triggerId', () => {
    render(
      <div>
        <label htmlFor="bound-trigger">Stock Item</label>
        <StockItemPicker
          instanceId="t"
          triggerId="bound-trigger"
          items={[SPLITTER]}
          selectedItemId=""
          onSelect={vi.fn()}
        />
      </div>
    );
    // getByLabelText resolves through htmlFor -> id, so this fails if the id is dropped.
    expect(screen.getByLabelText('Stock Item').tagName).toBe('BUTTON');
  });

  it('gives each instance its own listbox id so sibling rows do not collide', () => {
    const { container } = render(
      <div>
        <StockItemPicker instanceId="line-1" items={[SPLITTER]} selectedItemId="" onSelect={vi.fn()} />
        <StockItemPicker instanceId="line-2" items={[SPLITTER]} selectedItemId="" onSelect={vi.fn()} />
      </div>
    );
    const triggers = within(container).getAllByRole('button', { name: /select item/i });
    expect(triggers).toHaveLength(2);
    fireEvent.click(triggers[0]!);
    fireEvent.click(triggers[1]!);
    const ids = screen.getAllByRole('listbox').map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
