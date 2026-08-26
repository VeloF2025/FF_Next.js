/** @vitest-environment jsdom */
/**
 * The retention-hold panel in the incident review drawer.
 *
 * The property that carries this file: a hold is what stops an incident being
 * deleted, so everyone who can see the incident must be able to see that one
 * exists — while only a hold manager may create, review, extend or release it.
 * `canManage` and `canCreate` come from the server; the panel never infers them.
 *
 * These tests drive the REAL `retentionHoldApi` against a stubbed `fetch`
 * rather than a mock of the client. An earlier version mocked the client
 * wholesale and pinned the panel's own spelling of `nextReviewAt` — which was
 * the bare `YYYY-MM-DD` out of `<input type="date">`, a value the server's
 * `parseStrictIsoInstant` refuses. Every create and every review was a 400 and
 * the suite was green. What reaches the wire is now asserted with the server's
 * own parser, so the test cannot agree with the panel about a wrong format.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
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
import { parseStrictIsoInstant } from '../../../operations/instantValidation';
import type { RetentionHold } from '../../analytics/types';

const INCIDENT = '55555555-5555-4555-8555-555555555555';
const HOLD = '66666666-6666-4666-8666-666666666666';
const OTHER_HOLD = '77777777-7777-4777-8777-777777777777';
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
  return { holds: [hold()], actions: [], canManage: true, canCreate: true, ...over };
}

interface Sent { url: string; method: string; body: Record<string, unknown> }

/** Every non-GET request the panel actually put on the wire, decoded. */
const sent: Sent[] = [];
/** The queue of holds-view payloads `GET` answers with, newest last. */
let listResponses: unknown[] = [];
/** Set to make the next mutation reject the way the server would. */
let mutationFailure: { status: number; code: string; message: string } | null = null;
/** When open, mutations block on it — so "waits for the server" is observable. */
let gate: { blocked: Promise<void>; release: () => void } | null = null;

function openGate(): void {
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  gate = { blocked, release };
}

function json(status: number, payload: unknown): Response {
  return { ok: status < 400, status, json: async () => payload } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      const next = listResponses.length > 1 ? listResponses.shift() : listResponses[0];
      return json(200, { success: true, data: next });
    }
    sent.push({
      url: String(url), method,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    if (gate) await gate.blocked;
    if (mutationFailure) {
      const failure = mutationFailure;
      mutationFailure = null;
      return json(failure.status, { success: false, error: { code: failure.code, message: failure.message } });
    }
    return json(200, { success: true, data: hold() });
  });
}

async function flush(): Promise<void> {
  await act(async () => { for (let tick = 0; tick < 8; tick += 1) await Promise.resolve(); });
}

async function renderPanel(...responses: unknown[]) {
  listResponses = responses.length > 0 ? responses : [view()];
  render(<RetentionHoldPanel incidentId={INCIDENT} />);
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  mutationFailure = null;
  gate = null;
  stubFetch();
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
    await renderPanel(view({ canManage: false, canCreate: false }));
    expect((await screen.findByTestId('retention-holds')).textContent).toMatch(/held|on hold/i);
  });

  it('offers no create, review, extend or release control without authority', async () => {
    await renderPanel(view({ canManage: false, canCreate: false }));
    expect(screen.queryByTestId('hold-create')).toBeNull();
    expect(screen.queryByTestId('hold-review-legal')).toBeNull();
    expect(screen.queryByTestId('hold-release-legal')).toBeNull();
  });

  it('offers the review and release controls to a hold manager', async () => {
    await renderPanel();
    expect(screen.getByTestId('hold-review-legal')).toBeTruthy();
    expect(screen.getByTestId('hold-release-legal')).toBeTruthy();
  });

  /**
   * `create` and `edit` are separate grants on `fleet.retention-holds`, and
   * the service checks `create` for placing a hold. A viewer who may review
   * and release but not place must not be offered a button the server refuses.
   */
  it('hides the create form from a manager without create authority', async () => {
    await renderPanel(view({ canManage: true, canCreate: false }));
    expect(screen.queryByTestId('hold-create')).toBeNull();
    expect(screen.getByTestId('hold-release-legal')).toBeTruthy();
  });

  it('says plainly when nothing is holding the incident', async () => {
    await renderPanel(view({ holds: [] }));
    expect((await screen.findByTestId('retention-holds')).textContent).toMatch(/no hold|not held/i);
  });

  /**
   * The response-shape guard. A payload that is not the holds view used to
   * crash the whole drawer; defaulting it to "no holds" would be worse still,
   * because that reads as "nothing is holding this incident" for an answer
   * nobody gave. Deleting the guard fails here.
   */
  it('treats a response that is not the holds view as an error, not an empty panel', async () => {
    await renderPanel({ holds: 'all of them', canManage: true, canCreate: true });
    expect(await screen.findByTestId('hold-error')).toBeTruthy();
    expect(screen.queryByText(/no hold|not held/i)).toBeNull();
  });

  it('marks the hold error as an alert so it is announced', async () => {
    await renderPanel({ nothing: true });
    expect((await screen.findByTestId('hold-error')).getAttribute('role')).toBe('alert');
  });

  describe('creating a hold', () => {
    async function fillCreateForm(): Promise<void> {
      fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Insurer request' } });
      fireEvent.change(screen.getByTestId('hold-next-review'), { target: { value: '2026-12-01' } });
      fireEvent.change(screen.getByTestId('hold-category'), { target: { value: 'insurance' } });
      fireEvent.change(screen.getByTestId('hold-owner-input'), { target: { value: OWNER } });
    }

    it('will not submit without a reason', async () => {
      await renderPanel(view({ holds: [] }));
      fireEvent.change(screen.getByTestId('hold-next-review'), { target: { value: '2026-12-01' } });
      fireEvent.change(screen.getByTestId('hold-owner-input'), { target: { value: OWNER } });
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(sent).toHaveLength(0);
    });

    it('will not submit without a review date', async () => {
      await renderPanel(view({ holds: [] }));
      fireEvent.change(screen.getByTestId('hold-reason'), { target: { value: 'Insurer request' } });
      fireEvent.change(screen.getByTestId('hold-owner-input'), { target: { value: OWNER } });
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(sent).toHaveLength(0);
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
      expect(sent).toHaveLength(0);
    });

    it('sends the category, reason and owner once all are given', async () => {
      await renderPanel(view({ holds: [] }));
      await fillCreateForm();
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.url).toContain(`/api/fleet/incidents/${INCIDENT}/retention-holds`);
      expect(sent[0]!.body).toMatchObject({
        category: 'insurance', reason: 'Insurer request', ownerUserId: OWNER,
      });
    });

    /**
     * THE FORMAT BUG. `<input type="date">` yields `2026-12-01`; the server
     * parses `nextReviewAt` with `parseStrictIsoInstant`, which refuses it.
     * Asserted with that same parser rather than a regex of our own, so the
     * test cannot agree with the panel about a format the server rejects.
     * Sending the raw control value fails here.
     */
    it('sends the review date as a strict ISO instant, not the raw date input value', async () => {
      await renderPanel(view({ holds: [] }));
      await fillCreateForm();
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      const nextReviewAt = sent[0]!.body.nextReviewAt;
      expect(typeof nextReviewAt).toBe('string');
      expect(nextReviewAt).not.toBe('2026-12-01');
      expect(parseStrictIsoInstant(nextReviewAt as string)).not.toBeNull();
    });

    /**
     * The instant the panel sends for 1 December. Pinned as a literal so a
     * change of anchor shows up here, but note the limit: on a SAST machine —
     * which is what CI and every box here is — an implementation that used
     * LOCAL midnight instead produces this same value. The zone-independent
     * half of that guard lives in `retentionHoldDates.test.ts`.
     */
    it('anchors the chosen day to the start of that day in SAST', async () => {
      await renderPanel(view({ holds: [] }));
      await fillCreateForm();
      await act(async () => { screen.getByTestId('hold-create').click(); });
      await flush();
      expect(sent[0]!.body.nextReviewAt).toBe('2026-11-30T22:00:00.000Z');
    });
  });

  describe('reviewing and releasing', () => {
    it('requires a note before a review is sent', async () => {
      await renderPanel();
      fireEvent.change(screen.getByTestId('hold-next-review-legal'), { target: { value: '2027-02-01' } });
      await act(async () => { screen.getByTestId('hold-review-legal').click(); });
      await flush();
      expect(sent).toHaveLength(0);
    });

    it('requires a reason before a release is sent', async () => {
      await renderPanel();
      await act(async () => { screen.getByTestId('hold-release-legal').click(); });
      await flush();
      expect(sent).toHaveLength(0);
    });

    it('sends a release once a reason is given', async () => {
      await renderPanel();
      fireEvent.change(screen.getByTestId('hold-note-legal'), { target: { value: 'Matter closed' } });
      await act(async () => { screen.getByTestId('hold-release-legal').click(); });
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.url).toContain(`/retention-holds/${HOLD}/release`);
      expect(sent[0]!.body).toMatchObject({ releaseReason: 'Matter closed' });
    });

    /** Same conversion as create, on the path a hold spends most of its life on. */
    it('sends a review date as a strict ISO instant', async () => {
      await renderPanel();
      fireEvent.change(screen.getByTestId('hold-note-legal'), { target: { value: 'Still live' } });
      fireEvent.change(screen.getByTestId('hold-next-review-legal'), { target: { value: '2027-02-01' } });
      await act(async () => { screen.getByTestId('hold-review-legal').click(); });
      await flush();
      expect(sent[0]!.url).toContain(`/retention-holds/${HOLD}/review`);
      expect(sent[0]!.body.nextReviewAt).not.toBe('2027-02-01');
      expect(parseStrictIsoInstant(sent[0]!.body.nextReviewAt as string)).not.toBeNull();
    });
  });

  /**
   * Holds are unique per (incident, category) while active, so several can run
   * at once — a legal hold and an insurance hold are different obligations,
   * ending on different days. Both must be listed, each with its own labelled
   * Release, and releasing one must leave the other visibly held.
   */
  describe('several holds at once', () => {
    const two = [hold(), hold({ id: OTHER_HOLD, category: 'insurance', reason: 'Claim under assessment' })];

    it('lists every active hold with its own labelled release control', async () => {
      await renderPanel(view({ holds: two }));
      const panel = await screen.findByTestId('retention-holds');
      expect(panel.textContent).toContain('Attorney letter received');
      expect(panel.textContent).toContain('Claim under assessment');
      expect(screen.getByTestId('hold-release-legal').textContent).toMatch(/Legal/);
      expect(screen.getByTestId('hold-release-insurance').textContent).toMatch(/Insurance/);
    });

    it('releases only the hold whose button was pressed', async () => {
      await renderPanel(view({ holds: two }));
      fireEvent.change(screen.getByTestId('hold-note-insurance'), { target: { value: 'Claim settled' } });
      await act(async () => { screen.getByTestId('hold-release-insurance').click(); });
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.url).toContain(`/retention-holds/${OTHER_HOLD}/release`);
    });

    it('leaves the other hold visibly held after one is released', async () => {
      await renderPanel(
        view({ holds: two }),
        view({ holds: [two[0]!, hold({ id: OTHER_HOLD, category: 'insurance', status: 'released', releasedAt: '2026-09-01T08:00:00.000Z' })] }),
      );
      fireEvent.change(screen.getByTestId('hold-note-insurance'), { target: { value: 'Claim settled' } });
      await act(async () => { screen.getByTestId('hold-release-insurance').click(); });
      await flush();
      expect(screen.getByTestId('hold-release-legal')).toBeTruthy();
      expect(screen.queryByTestId('hold-release-insurance')).toBeNull();
    });

    /**
     * The create control does not disappear at the first hold — only when
     * every category is spoken for. An incident under a legal hold can still
     * need a health-and-safety one.
     */
    it('keeps the create control while categories remain free', async () => {
      await renderPanel(view({ holds: two }));
      expect(screen.getByTestId('hold-create')).toBeTruthy();
      const options = Array.from(screen.getByTestId('hold-category').querySelectorAll('option'))
        .map((option) => option.getAttribute('value'));
      expect(options).not.toContain('legal');
      expect(options).not.toContain('insurance');
      expect(options).toContain('accident');
    });

    it('withdraws the create control once every category is held', async () => {
      const all = ['health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved']
        .map((category, index) => hold({ id: `0000000${index}-0000-4000-8000-000000000000`, category: category as RetentionHold['category'] }));
      await renderPanel(view({ holds: all }));
      expect(screen.queryByTestId('hold-create')).toBeNull();
    });
  });

  /**
   * Releasing a hold makes an incident deletable again. Showing it as released
   * before the server confirmed would leave a manager believing they had
   * finished something that had not happened.
   */
  it('waits for the server before showing a release as done', async () => {
    await renderPanel(
      view(),
      view({ holds: [hold({ status: 'released', releasedAt: '2026-09-01T08:00:00.000Z' })] }),
    );
    openGate();

    fireEvent.change(screen.getByTestId('hold-note-legal'), { target: { value: 'Matter closed' } });
    await act(async () => { screen.getByTestId('hold-release-legal').click(); });
    await flush();
    expect(screen.getByTestId('retention-holds').textContent).not.toMatch(/released/i);

    const { release } = gate!;
    gate = null;
    await act(async () => { release(); });
    await flush();
    expect(screen.getByTestId('retention-holds').textContent).toMatch(/released/i);
  });

  it('reports a refused action in the server words', async () => {
    await renderPanel();
    mutationFailure = { status: 403, code: 'FORBIDDEN', message: 'Only a hold manager may release a hold' };
    fireEvent.change(screen.getByTestId('hold-note-legal'), { target: { value: 'Matter closed' } });
    await act(async () => { screen.getByTestId('hold-release-legal').click(); });
    await flush();
    expect((await screen.findByTestId('hold-error')).textContent).toContain('hold manager');
  });

  it('shows a load failure rather than an empty panel that reads as unheld', async () => {
    vi.stubGlobal('fetch', async () => json(500, {
      success: false, error: { code: 'INTERNAL', message: 'connection reset' },
    }));
    render(<RetentionHoldPanel incidentId={INCIDENT} />);
    await flush();
    expect(await screen.findByTestId('hold-error')).toBeTruthy();
    expect(screen.queryByText(/no hold|not held/i)).toBeNull();
  });
});
