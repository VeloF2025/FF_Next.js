/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: logMock }));

import { IncidentTimeline } from '../IncidentTimeline';
import type { IncidentTimelineEntry, IncidentTimelinePage } from '../../analytics/types';

function entry(overrides: Partial<IncidentTimelineEntry> = {}): IncidentTimelineEntry {
  return {
    stableId: 'manager:action-1', source: 'manager', entryType: 'acknowledged',
    occurredAt: '2026-08-18T07:05:00.000Z', recordedAt: '2026-08-18T07:05:00.000Z',
    summary: 'Acknowledged', actorLabel: 'Thabo Nkosi',
    ...overrides,
  };
}

function page(overrides: Partial<IncidentTimelinePage> = {}): IncidentTimelinePage {
  return { entries: [entry()], nextCursor: null, ...overrides };
}

function ok(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
}
function fail(status: number, code: string, message: string): Response {
  return { ok: false, status, json: async () => ({ success: false, error: { code, message } }) } as Response;
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
/** A request that stays in flight until it is aborted, then rejects the way fetch does. */
function abortable(): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue(ok(page()));
});

describe('IncidentTimeline states', () => {
  it('shows a loading state until the first page arrives', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    render(<IncidentTimeline incidentId="incident-1" />);
    expect(screen.getByText(/loading chronology/i)).toBeTruthy();
    await act(async () => { pending.resolve(ok(page())); });
    await waitFor(() => expect(screen.queryByText(/loading chronology/i)).toBeNull());
  });

  it('explains an empty chronology instead of rendering nothing', async () => {
    fetchMock.mockResolvedValue(ok(page({ entries: [] })));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getByText(/no chronology recorded yet/i)).toBeTruthy());
  });

  it('distinguishes a permission failure from a general one', async () => {
    fetchMock.mockResolvedValue(fail(403, 'FORBIDDEN', 'nope'));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/cannot view this chronology/i));
  });

  it('reports a general failure without claiming the chronology is empty', async () => {
    fetchMock.mockResolvedValue(fail(500, 'INTERNAL_ERROR', 'boom'));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i));
    expect(screen.queryByText(/no chronology recorded yet/i)).toBeNull();
  });
});

describe('IncidentTimeline rendering', () => {
  it('renders entries in the order the server returned them', async () => {
    fetchMock.mockResolvedValue(ok(page({
      entries: [
        entry({ stableId: 'system:o1', source: 'system', summary: 'Condition observed', actorLabel: null, occurredAt: '2026-08-18T06:58:00.000Z', recordedAt: '2026-08-18T06:58:00.000Z' }),
        entry({ stableId: 'manager:a1' }),
      ],
    })));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const rendered = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-testid'));
    expect(rendered).toEqual(['timeline-system:o1', 'timeline-manager:a1']);
  });

  it('labels the source of every entry', async () => {
    fetchMock.mockResolvedValue(ok(page({
      entries: [
        entry({ stableId: 'driver:d1', source: 'driver', summary: 'Driver responded', actorLabel: null }),
        entry({ stableId: 'retention_hold:h1', source: 'retention_hold', summary: 'Retention hold created' }),
      ],
    })));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getByText('Driver')).toBeTruthy());
    expect(screen.getByText('Retention hold')).toBeTruthy();
  });

  it('names the actor when there is one', async () => {
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getByText(/Thabo Nkosi/)).toBeTruthy());
  });

  it('marks an entry recorded later than it happened, and only then', async () => {
    fetchMock.mockResolvedValue(ok(page({
      entries: [
        entry({ stableId: 'system:o1', source: 'system', summary: 'Condition observed', actorLabel: null, occurredAt: '2026-08-18T06:55:00.000Z', recordedAt: '2026-08-18T07:05:00.000Z' }),
        entry({ stableId: 'manager:a1' }),
      ],
    })));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.getAllByText(/recorded/i)).toHaveLength(1);
  });
});

describe('IncidentTimeline pagination', () => {
  it('offers more only when the server said there is more', async () => {
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('appends the next page rather than replacing the first', async () => {
    fetchMock.mockResolvedValueOnce(ok(page({ nextCursor: 'CURSOR-1' })));
    fetchMock.mockResolvedValueOnce(ok(page({ entries: [entry({ stableId: 'manager:action-2' })], nextCursor: null })));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await flush();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=CURSOR-1');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('keeps what it already showed when the next page fails', async () => {
    fetchMock.mockResolvedValueOnce(ok(page({ nextCursor: 'CURSOR-1' })));
    fetchMock.mockResolvedValueOnce(fail(500, 'INTERNAL_ERROR', 'boom'));
    render(<IncidentTimeline incidentId="incident-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('IncidentTimeline staleness', () => {
  it('discards a first-page response that arrives after the incident changed', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<IncidentTimeline incidentId="incident-1" />);
    fetchMock.mockResolvedValue(ok(page({ entries: [entry({ stableId: 'manager:from-2' })] })));
    rerender(<IncidentTimeline incidentId="incident-2" />);
    await waitFor(() => expect(screen.getByTestId('timeline-manager:from-2')).toBeTruthy());

    // The abandoned request for incident-1 now answers. Its entries belong to a
    // different incident and must never reach the list the manager is reading.
    await act(async () => { pending.resolve(ok(page({ entries: [entry({ stableId: 'manager:from-1' })] }))); });
    await flush();
    expect(screen.queryByTestId('timeline-manager:from-1')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByTestId('timeline-manager:from-2')).toBeTruthy();
  });

  it('aborts the in-flight request when the incident changes', async () => {
    fetchMock.mockReturnValueOnce(deferred<Response>().promise);
    const { rerender } = render(<IncidentTimeline incidentId="incident-1" />);
    rerender(<IncidentTimeline incidentId="incident-2" />);
    await flush();
    const first = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(first?.signal?.aborted).toBe(true);
  });
});

describe('IncidentTimeline refresh', () => {
  it('reloads the chronology when the drawer reports a change', async () => {
    render(<IncidentTimeline incidentId="incident-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the refresh key changes, and not otherwise', async () => {
    const { rerender } = render(<IncidentTimeline incidentId="incident-1" refreshKey={0} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(<IncidentTimeline incidentId="incident-1" refreshKey={0} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender(<IncidentTimeline incidentId="incident-1" refreshKey={1} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe('IncidentTimeline teardown', () => {
  it('does not report the request that unmounting abandoned as a failed chronology', async () => {
    // Aborting rejects the in-flight fetch. Without moving the generation on,
    // that rejection is still the newest request as far as the loader knows, so
    // it would log a failed chronology and set state on a gone component.
    fetchMock.mockImplementationOnce(() => abortable());
    const { unmount } = render(<IncidentTimeline incidentId="incident-1" />);
    unmount();
    await flush();
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it('does not report the request that changing incident abandoned', async () => {
    fetchMock.mockImplementationOnce(() => abortable());
    const { rerender } = render(<IncidentTimeline incidentId="incident-1" />);
    rerender(<IncidentTimeline incidentId="incident-2" />);
    await flush();
    expect(logMock.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
