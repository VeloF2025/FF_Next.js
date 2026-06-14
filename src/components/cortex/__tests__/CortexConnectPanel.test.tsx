/**
 * @vitest-environment jsdom
 *
 * Render + interaction tests for the "Connect to Claude (MCP)" panel. Proves the
 * panel renders, mints via POST /api/cortex/mcp-token, reveals the token + config +
 * expiry, and surfaces errors. (Render-time crashes are additionally caught by the
 * real-browser verification at deploy.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CortexConnectPanel } from '../CortexConnectPanel';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsImtpZCI6IjIwMjYwNjExIn0.payload.sig';

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText } });
  writeText.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(impl: () => Partial<Response> & { json: () => Promise<unknown> }) {
  vi.stubGlobal('fetch', vi.fn(async () => impl() as unknown as Response));
}

describe('CortexConnectPanel', () => {
  it('renders the generate button and no token initially', () => {
    render(<CortexConnectPanel />);
    expect(screen.getByRole('button', { name: /generate token/i })).toBeTruthy();
    expect(screen.queryByLabelText(/cortex mcp token/i)).toBeNull();
  });

  it('mints and reveals the token, expiry and config on success', async () => {
    mockFetchOnce(() => ({
      ok: true,
      json: async () => ({ data: { token: TOKEN, expiresAt: '2026-07-14T00:00:00.000Z' } }),
    }));
    render(<CortexConnectPanel />);
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));

    const input = (await screen.findByLabelText(/cortex mcp token/i)) as HTMLInputElement;
    expect(input.value).toBe(TOKEN);
    expect(global.fetch).toHaveBeenCalledWith('/api/cortex/mcp-token', { method: 'POST' });
    // Expiry rendered and the config snippet carries the token.
    expect(screen.getByText(/^Expires /)).toBeTruthy();
    expect(screen.getByText(/CORTEX_USER_TOKEN/)).toBeTruthy();
    // After a successful mint the button offers regeneration.
    expect(screen.getByRole('button', { name: /regenerate token/i })).toBeTruthy();
  });

  it('copies the token to the clipboard', async () => {
    mockFetchOnce(() => ({
      ok: true,
      json: async () => ({ data: { token: TOKEN, expiresAt: '2026-07-14T00:00:00.000Z' } }),
    }));
    render(<CortexConnectPanel />);
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));
    await screen.findByLabelText(/cortex mcp token/i);

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN));
  });

  it('shows an error and no token when the mint fails', async () => {
    mockFetchOnce(() => ({ ok: false, status: 403, json: async () => ({}) }));
    render(<CortexConnectPanel />);
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));

    await waitFor(() => expect(screen.getByText(/could not generate a token/i)).toBeTruthy());
    expect(screen.queryByLabelText(/cortex mcp token/i)).toBeNull();
  });
});
