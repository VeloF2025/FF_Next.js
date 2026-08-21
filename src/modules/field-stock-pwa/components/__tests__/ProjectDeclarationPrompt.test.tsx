/**
 * ProjectDeclarationPrompt — asks a worker their project, but only when the
 * server says we don't already know it from today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectDeclarationPrompt } from '../ProjectDeclarationPrompt';

const OPTIONS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Lawley' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Mohadin' },
];

function mockStatus(over: Record<string, unknown>) {
  global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, json: async () => ({ success: true }) } as Response;
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { projectId: null, source: 'none', shouldAsk: true, suggestedProjectName: null, options: OPTIONS, ...over },
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('ProjectDeclarationPrompt', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    vi.resetAllMocks();
    // The component caches "settled for today" in sessionStorage so the shell
    // does not refetch on every /my page. Clear it or tests leak into each other.
    sessionStorage.clear();
  });
  afterEach(() => { global.fetch = realFetch; });

  it('asks when the server says nothing is known today', async () => {
    mockStatus({});
    render(<ProjectDeclarationPrompt />);
    expect(await screen.findByText('Which project are you on today?')).toBeInTheDocument();
  });

  it('stays SILENT when the morning check-in already answered it', async () => {
    // Asking twice is how a prompt gets clicked through without reading.
    mockStatus({ shouldAsk: false, source: 'checkin-today', projectId: OPTIONS[0]!.id });
    const { container } = render(<ProjectDeclarationPrompt />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('pre-selects the standing declaration so confirming is one tap', async () => {
    mockStatus({
      projectId: OPTIONS[1]!.id, source: 'stale-declaration',
      shouldAsk: true, suggestedProjectName: 'Mohadin',
    });
    render(<ProjectDeclarationPrompt />);
    await screen.findByText(/We have you on Mohadin/);
    expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe(OPTIONS[1]!.id);
  });

  it('posts the chosen project and then disappears', async () => {
    mockStatus({});
    render(<ProjectDeclarationPrompt />);
    await screen.findByText('Which project are you on today?');

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: OPTIONS[0]!.id } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    await waitFor(() => {
      const calls = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
      const post = calls.find((c) => c[1]?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1]!.body as string)).toEqual({ projectId: OPTIONS[0]!.id });
    });
    await waitFor(() => expect(screen.queryByText('Which project are you on today?')).toBeNull());
  });

  it('can be dismissed without answering, so it never traps the worker', async () => {
    mockStatus({});
    render(<ProjectDeclarationPrompt />);
    await screen.findByText('Which project are you on today?');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('Which project are you on today?')).toBeNull());
  });

  it('does not call the server again once today is settled', async () => {
    // The shell renders this on EVERY /my page. Without the cache an office
    // worker who will never be asked pays a round trip on every page.
    mockStatus({ shouldAsk: false, source: 'checkin-today', projectId: OPTIONS[0]!.id });

    const first = render(<ProjectDeclarationPrompt />);
    // Wait for the RESPONSE to be handled, not merely for the request to fire —
    // the cache is written after the await, and unmounting earlier would race.
    await waitFor(() => expect(Object.keys(sessionStorage)).toHaveLength(1));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<ProjectDeclarationPrompt />);
    await new Promise((r) => setTimeout(r, 10));
    expect(global.fetch).toHaveBeenCalledTimes(1); // still one — not two
  });

  it('remembers a dismissal for the rest of the day', async () => {
    mockStatus({});
    render(<ProjectDeclarationPrompt />);
    await screen.findByText('Which project are you on today?');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('Which project are you on today?')).toBeNull());
    expect(Object.keys(sessionStorage)).toHaveLength(1);
  });

  it('never blocks the portal when the status call fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    const { container } = render(<ProjectDeclarationPrompt />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
