/**
 * @vitest-environment jsdom
 *
 * Tests for the /cortex premium hero. Proves the accessible heading name, and that
 * the CONTROL stat card's dot + label correctly reflect the pending-review count:
 * unknown (loading) → neutral dot + "Human review gates" (never a false "all clear"),
 * >0 → gold + "{n} pending review", 0 → green + "All clear", and a non-ok response
 * leaves the fallback in place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CortexHero } from '../CortexHero';

function stubFetch(impl: () => Partial<Response> & { json: () => Promise<unknown> }) {
  vi.stubGlobal('fetch', vi.fn(async () => impl() as unknown as Response));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CortexHero', () => {
  it('exposes "Cortex" as the heading accessible name (not "ortex")', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); // never resolves
    render(<CortexHero />);
    expect(screen.getByRole('heading', { level: 1, name: /^cortex$/i })).toBeTruthy();
  });

  it('shows a neutral dot and "Human review gates" while the count is still unknown', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<CortexHero />);
    expect(screen.getByText('Human review gates')).toBeTruthy();
    expect(container.querySelector('.cx-dot--neutral')).toBeTruthy();
    // Must NOT claim "all clear" (green) before we know the count.
    expect(container.querySelector('.cx-dot--green')).toBeNull();
  });

  it('shows a gold dot and the count when items are pending', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] }) }));
    const { container } = render(<CortexHero />);
    await screen.findByText('3 pending review');
    expect(container.querySelector('.cx-dot--gold')).toBeTruthy();
  });

  it('shows a green dot and "All clear" when the queue is empty', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ data: [] }) }));
    const { container } = render(<CortexHero />);
    await screen.findByText('All clear');
    expect(container.querySelector('.cx-dot--green')).toBeTruthy();
  });

  it('keeps the unknown-state fallback when the request is not ok', async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const { container } = render(<CortexHero />);
    await waitFor(() => expect(screen.getByText('Human review gates')).toBeTruthy());
    expect(container.querySelector('.cx-dot--neutral')).toBeTruthy();
  });
});
