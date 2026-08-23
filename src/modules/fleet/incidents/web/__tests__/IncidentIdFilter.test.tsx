/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IncidentIdFilter } from '../IncidentIdFilter';
import type { ActiveUserOption } from '../incidentApi';

const LAWLEY: ActiveUserOption = { id: 'project-9', name: 'Lawley' };

function setup(overrides: Partial<React.ComponentProps<typeof IncidentIdFilter>> = {}) {
  const props = {
    label: 'Project',
    value: undefined as string | undefined,
    onChange: vi.fn(),
    search: vi.fn(async () => [LAWLEY]),
    resolveById: vi.fn(async () => LAWLEY),
    ...overrides,
  };
  const view = render(<IncidentIdFilter {...props} />);
  return { ...props, view };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Advances past the 300ms debounce and lets the resulting promise settle. */
async function settleDebounce() {
  await act(async () => { vi.advanceTimersByTime(350); });
}

describe('IncidentIdFilter search debounce', () => {
  it('issues no search before the debounce elapses', async () => {
    const { search } = setup();
    fireEvent.change(screen.getByLabelText('Project search'), { target: { value: 'Law' } });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(search).not.toHaveBeenCalled();
  });

  it('collapses a burst of keystrokes into ONE search for the final term', async () => {
    // Each keystroke sends a partial name to the server. Without the debounce
    // this types-4-characters case issues 4 lookups; the guard is that it issues 1.
    const { search } = setup();
    const input = screen.getByLabelText('Project search');
    for (const term of ['L', 'La', 'Law', 'Lawl']) {
      fireEvent.change(input, { target: { value: term } });
      await act(async () => { vi.advanceTimersByTime(50) });
    }
    await settleDebounce();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('Lawl', expect.anything());
  });

  it('aborts the in-flight request when the term changes again', async () => {
    const signals: AbortSignal[] = [];
    const search = vi.fn(async (_term: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return [LAWLEY];
    });
    setup({ search });
    const input = screen.getByLabelText('Project search');

    fireEvent.change(input, { target: { value: 'Law' } });
    await settleDebounce();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    fireEvent.change(input, { target: { value: 'Mohadin' } });
    await settleDebounce();
    // The first request's signal must be aborted, not left running.
    expect(signals[0]!.aborted).toBe(true);
  });

  it('does not search on an empty or whitespace-only term', async () => {
    const { search } = setup();
    const input = screen.getByLabelText('Project search');
    fireEvent.change(input, { target: { value: '   ' } });
    await settleDebounce();
    expect(search).not.toHaveBeenCalled();
  });
});

describe('IncidentIdFilter selection', () => {
  it('reports the picked option id and shows its name', async () => {
    const { search, onChange } = setup();
    fireEvent.change(screen.getByLabelText('Project search'), { target: { value: 'Law' } });
    await settleDebounce();
    expect(search).toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Lawley' }));
    expect(onChange).toHaveBeenCalledWith('project-9');
  });

  it('clears back to the search input', async () => {
    const { onChange } = setup({ value: 'project-9' });
    await waitFor(() => expect(screen.getByText('Lawley')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe('IncidentIdFilter deep-link resolution', () => {
  it('resolves a pre-set id via resolveById, NOT via search', async () => {
    // search() matches names; passing it a raw UUID never matches, which would
    // leave the filter displaying the UUID forever.
    const { resolveById, search } = setup({ value: 'project-9' });
    await waitFor(() => expect(screen.getByText('Lawley')).toBeInTheDocument());
    expect(resolveById).toHaveBeenCalledWith('project-9', expect.anything());
    expect(search).not.toHaveBeenCalled();
  });

  it('resolves each id once even when the parent passes a fresh callback each render', async () => {
    // The effect depends on [value, resolveById]. A parent that inlines the
    // resolver — `resolveById={(id) => api.resolve(id)}` — hands over a NEW
    // function identity on every render, so the effect re-runs and, without the
    // lastResolvedFor guard, fires a request per parent render. Re-rendering
    // with the SAME resolver reference would not exercise this at all: React
    // skips the effect on identical deps, so such a test passes with or without
    // the guard.
    const underlying = vi.fn(async () => LAWLEY);
    const view = render(<IncidentIdFilter label="Project" value="project-9" onChange={vi.fn()}
      search={vi.fn(async () => [])} resolveById={(id, signal) => underlying(id, signal)} />);
    await waitFor(() => expect(screen.getByText('Lawley')).toBeInTheDocument());

    for (let i = 0; i < 3; i += 1) {
      view.rerender(<IncidentIdFilter label="Project" value="project-9" onChange={vi.fn()}
        search={vi.fn(async () => [])} resolveById={(id, signal) => underlying(id, signal)} />);
      await act(async () => { await Promise.resolve(); });
    }

    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('resolves again when the id itself changes', async () => {
    // The guard must key on the value, not latch permanently after the first resolve.
    const underlying = vi.fn(async (id: string) => ({ id, name: id === 'project-9' ? 'Lawley' : 'Mohadin' }));
    const view = render(<IncidentIdFilter label="Project" value="project-9" onChange={vi.fn()}
      search={vi.fn(async () => [])} resolveById={(id, signal) => underlying(id, signal)} />);
    await waitFor(() => expect(screen.getByText('Lawley')).toBeInTheDocument());

    view.rerender(<IncidentIdFilter label="Project" value="project-42" onChange={vi.fn()}
      search={vi.fn(async () => [])} resolveById={(id, signal) => underlying(id, signal)} />);
    await waitFor(() => expect(screen.getByText('Mohadin')).toBeInTheDocument());
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it('falls back to the raw id when resolution fails, keeping the filter usable', async () => {
    const resolveById = vi.fn(async () => { throw new Error('boom'); });
    setup({ value: 'project-9', resolveById });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('project-9')).toBeInTheDocument();
  });

  it('falls back to the raw id when the resource is not found', async () => {
    const resolveById = vi.fn(async () => null);
    setup({ value: 'project-9', resolveById });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('project-9')).toBeInTheDocument();
  });
});
