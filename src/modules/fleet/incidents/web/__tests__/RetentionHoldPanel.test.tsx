/** @vitest-environment jsdom */
/**
 * The retention-hold panel in the incident review drawer.
 *
 * The property that carries this file: a hold is what stops an incident being
 * deleted, so everyone who can see the incident must be able to see that one
 * exists — while only a hold manager may create, review, extend or release it.
 * `canManage` comes from the server; the panel never infers it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), review: vi.fn(), release: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../retentionHoldApi', () => ({
  retentionHoldApi: {
    list: mocks.list, create: mocks.create, review: mocks.review, release: mocks.release,
  },
}));
/**
 * The owner picker is a debounced type-a-name-then-pick control with its own
 * tests. Standing in a plain input keeps these tests about the hold rules
 * rather than about re-driving that interaction.
 */
vi.mock('../IncidentIdFilter', () => ({
  IncidentIdFilter: ({ value, onChange }: { value?: string; onChange: (id?: string) => void }) => (
    <input
      data-testid="hold-owner-input" value={value ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  ),
}));

import { RetentionHoldPanel } from '../RetentionHoldPanel';
import { IncidentApiError } from '../incidentApi';
import type { RetentionHold } from '../../analytics/types';

const INCIDENT = '55555555-5555-4555-8555-555555555555';
const HOLD = '66666666-6666-4666-8666-666666666666';
const OWNER = '11111111-1111-4111-8111-111111111111';

function hold(over: Partial<RetentionHold> = {}): RetentionHold {
  return {
    id: HOLD, incidentId: INCIDENT, category: 'legal', status: 'active',
    reason: 'Attorney letter received', ownerUserId: OWNER,
    holdStartAt: '2026-08-01T08:00:00.000Z', nextReviewAt: '2026-11-01T08:00:00.000Z',
    lastReviewedAt: null, releasedAt: null, ...over,
  };
}

function view(over: Record<string, unknown> = {}) {
  return { holds: [hold()], actions: [], canManage: true, ...over };
}

async function flush(): Promise<void> {
  await act(async () => { for (let tick = 0; tick < 5; tick += 1) await Promise.resolve(); });
}

async function renderPanel(response: unknown = view()) {
  mocks.list.mockResolvedValue(response);
  render(<RetentionHoldPanel incidentId={INCIDENT} />);
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(hold());
  mocks.review.mockResolvedValue(hold());
  mocks.release.mockResolvedValue(hold({ status: 'released' }));
});

describe('RetentionHoldPanel', () => {
  it('shows an active hold with the reason and the review date', async () => {
    await renderPanel();
    const panel = await screen.findByTestId('retention-holds');
    expect(panel.textContent).toContain('Attorney letter received');
    expect(panel.textContent).toMatch(/Legal/i);
  });

  /**
   * The badge is the point of showing this to a scoped viewer at all: an
   * incident that cannot be deleted looks exactly like one that can, and a PM
   * chasing a stale incident deserves to know why it is still there.
   */
  it('shows the held badge to a viewer who cannot manage holds', async () => {
    await renderPanel(view({ canManage: false }));
    expect((await screen.findByTestId('retention-holds')).textContent).toMatch(/held|on hold/i);
  });

  it('offers no create, review, extend or release control without authority', async () => {
    await renderPanel(view({ canManage: false }));
    expect(screen.queryByTestId('hold-create')).toBeNull();
    expect(screen.queryByTestId('hold-review')).toBeNull();
    expect(screen.queryByTestId('hold-release')).toBeNull();
  });

  it('offers the controls to a hold manager', async () => {
    await renderPanel();
    expect(screen.getByTestId('hold-review')).toBeTruthy();
    expect(screen.getByTestId('hold-release')).toBeTruthy();
  });

  it('says plainly when nothing is holding the incident', async () => {
    await renderPanel(view({ holds: [] }));
    expect((await screen.findByTestId('retention-holds')).textContent).toMatch(/no hold|not held/i);
  });

  describe('creating a hold', () => {
    it('will not submit without a reason', async () => {
      await renderPanel(view({ holds: [] }));
      fireEvent.change(screen.getByTestId('hold-next-review'), { target: { value: '2026-12-01' } });
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('will not submit without a review date', async () => {
      await renderPanel(view({ holds: [] }));
      fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Insurer request' } });
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(mocks.create).not.toHaveBeenCalled();
    });

    /**
     * The server requires an owner that is an active FibreFlow user, so an
     * unset owner is a request guaranteed to fail after the click. Caught
     * before it is sent rather than reported back as a validation error.
     */
    it('will not submit without an owner', async () => {
      await renderPanel(view({ holds: [] }));
      fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Insurer request' } });
      fireEvent.change(screen.getByTestId('hold-next-review'), { target: { value: '2026-12-01' } });
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('sends the category, reason, owner and review date once all are given', async () => {
      await renderPanel(view({ holds: [] }));
      fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Insurer request' } });
      fireEvent.change(screen.getByTestId('hold-next-review'), { target: { value: '2026-12-01' } });
      fireEvent.change(screen.getByTestId('hold-category'), { target: { value: 'insurance' } });
      fireEvent.change(screen.getByTestId('hold-owner-input'), { target: { value: OWNER } });
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(mocks.create).toHaveBeenCalledWith(INCIDENT, expect.objectContaining({
        category: 'insurance', reason: 'Insurer request', ownerUserId: OWNER, nextReviewAt: '2026-12-01',
      }));
    });
  });

  describe('reviewing and releasing', () => {
    it('requires a note before a review is sent', async () => {
      await renderPanel();
      fireEvent.change(screen.getByTestId('hold-next-review'), { target: { value: '2027-02-01' } });
      await act(async () => { screen.getByTestId('hold-review').click(); });
      await flush();
      expect(mocks.review).not.toHaveBeenCalled();
    });

    it('requires a reason before a release is sent', async () => {
      await renderPanel();
      await act(async () => { screen.getByTestId('hold-release').click(); });
      await flush();
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it('sends a release once a reason is given', async () => {
      await renderPanel();
      fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Matter closed' } });
      await act(async () => { screen.getByTestId('hold-release').click(); });
      await flush();
      expect(mocks.release).toHaveBeenCalledWith(INCIDENT, HOLD, expect.objectContaining({
        releaseReason: 'Matter closed',
      }));
    });
  });

  /**
   * Releasing a hold makes an incident deletable again. Showing it as released
   * before the server confirmed would leave a manager believing they had
   * finished something that had not happened.
   */
  it('waits for the server before showing a release as done', async () => {
    await renderPanel();
    let settle: (value: unknown) => void = () => undefined;
    mocks.release.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    mocks.list.mockResolvedValue(view({ holds: [hold({ status: 'released', releasedAt: '2026-09-01T08:00:00.000Z' })] }));

    fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Matter closed' } });
    await act(async () => { screen.getByTestId('hold-release').click(); });
    await flush();
    expect(screen.getByTestId('retention-holds').textContent).not.toMatch(/released/i);

    await act(async () => { settle(hold({ status: 'released' })); });
    await flush();
    expect(screen.getByTestId('retention-holds').textContent).toMatch(/released/i);
  });

  it('reports a refused action in the server words', async () => {
    await renderPanel();
    mocks.release.mockRejectedValue(new IncidentApiError('Only a hold manager may release a hold', 403, 'FORBIDDEN'));
    fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Matter closed' } });
    await act(async () => { screen.getByTestId('hold-release').click(); });
    await flush();
    expect((await screen.findByTestId('hold-error')).textContent).toContain('hold manager');
  });

  it('shows a load failure rather than an empty panel that reads as unheld', async () => {
    mocks.list.mockRejectedValue(new IncidentApiError('connection reset', 500, 'INTERNAL'));
    render(<RetentionHoldPanel incidentId={INCIDENT} />);
    await flush();
    expect(await screen.findByTestId('hold-error')).toBeTruthy();
    expect(screen.queryByText(/no hold|not held/i)).toBeNull();
  });
});
