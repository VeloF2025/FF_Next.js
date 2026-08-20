/**
 * Requisition form — stock catalogue linkage.
 *
 * A requisition line that carries no stock_item_id produces a PO line with no
 * stock_item_id, which produces a goods receipt line the stock posting skips.
 * That is why goods were being "received" into nothing: the form was free text
 * with no way to name a catalogue item.
 *
 * These mount the real page and drive it the way a person does — open the
 * picker from a line, choose an item, submit — then assert on the payload that
 * actually reaches the API.
 *
 * It lives under tests/ rather than beside the page: anything under pages/ is a
 * route, and Next collects page data from it at build time. A test file there
 * imports vitest during the build and fails it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/layout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/services/core/NotificationService', () => ({
  notificationService: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Stand-in for the catalogue modal. The real one is exercised by the RFQ form;
 * what matters here is that this page hands it a line and stores what comes
 * back, so the stub renders a button that returns one catalogue item.
 */
vi.mock('@/components/procurement/StockItemSelector', () => ({
  StockItemSelector: ({ isOpen, onSelect }: {
    isOpen: boolean;
    onSelect: (i: { stockItemId: string; description: string; unit: string; estimatedUnitPrice: number }) => void;
  }) => (isOpen ? (
    <button
      type="button"
      onClick={() => onSelect({
        stockItemId: 'stock-cableclip',
        description: '3mm Cable Clips',
        unit: 'unit',
        estimatedUnitPrice: 12.5,
      })}
    >
      pick 3mm Cable Clips
    </button>
  ) : null),
}));

import NewRequisitionPage from '@/../pages/procurement/requisitions/new';

/** Last body posted to /api/procurement/requisitions. */
function lastRequisitionBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/api/procurement/requisitions'))
    .pop();
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/api/projects')) {
      return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
    }
    if (String(url).includes('/api/departments')) {
      return {
        ok: true,
        json: async () => ({ success: true, data: [{ id: 'dept-1', name: 'Operations' }] }),
      } as Response;
    }
    return { ok: true, json: async () => ({ success: true, data: { id: 'pr-1' } }) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function fillLineAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  const qty = screen.getAllByRole('spinbutton')[0]!;
  await user.clear(qty);
  await user.type(qty, '500');
  // A requisition needs a project or a department before it will submit.
  // The select carries no accessible name (its label is not associated with
  // it), so it is located by the option it renders.
  const dept = await waitFor(() => {
    const found = screen.getAllByRole('combobox')
      .find((el) => el.textContent?.includes('Operations'));
    if (!found) throw new Error('department select not populated yet');
    return found;
  });
  await user.selectOptions(dept, 'Operations');
  await user.click(screen.getByRole('button', { name: /create requisition/i }));
}

describe('New requisition — stock catalogue linkage', () => {
  it('sends the stock item id chosen from the catalogue', async () => {
    const user = userEvent.setup();
    render(<NewRequisitionPage />);

    await user.click(screen.getByTitle(/pick from the stock catalogue/i));
    await user.click(await screen.findByRole('button', { name: /pick 3mm cable clips/i }));

    // Choosing an item fills the line in, so the description is no longer blank.
    await waitFor(() => expect(screen.getByDisplayValue('3mm Cable Clips')).toBeTruthy());

    await fillLineAndSubmit(user);

    await waitFor(() => {
      const body = lastRequisitionBody(fetchMock);
      expect(body).toBeTruthy();
      expect(body.items[0].stockItemId).toBe('stock-cableclip');
      expect(body.items[0].itemDescription).toBe('3mm Cable Clips');
    });
  });

  it('sends no stock item id for a hand-typed line', async () => {
    const user = userEvent.setup();
    render(<NewRequisitionPage />);

    await user.type(screen.getByPlaceholderText(/item description/i), 'Something not in the catalogue');
    await fillLineAndSubmit(user);

    await waitFor(() => {
      const body = lastRequisitionBody(fetchMock);
      expect(body).toBeTruthy();
      expect(body.items[0].stockItemId).toBeUndefined();
    });
  });

  it('drops the link when the description is typed over', async () => {
    // Otherwise the line would receive a different item than it now names.
    const user = userEvent.setup();
    render(<NewRequisitionPage />);

    await user.click(screen.getByTitle(/pick from the stock catalogue/i));
    await user.click(await screen.findByRole('button', { name: /pick 3mm cable clips/i }));
    await waitFor(() => expect(screen.getByDisplayValue('3mm Cable Clips')).toBeTruthy());

    const description = screen.getByDisplayValue('3mm Cable Clips');
    await user.clear(description);
    await user.type(description, 'M8 Wall plug');

    await fillLineAndSubmit(user);

    await waitFor(() => {
      const body = lastRequisitionBody(fetchMock);
      expect(body).toBeTruthy();
      expect(body.items[0].itemDescription).toBe('M8 Wall plug');
      expect(body.items[0].stockItemId).toBeUndefined();
    });
  });
});
