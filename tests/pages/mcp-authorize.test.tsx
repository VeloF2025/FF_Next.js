/**
 * Tests for the connector consent page (pages/mcp/authorize.tsx).
 *
 * The two properties worth guarding are the ones that silently break an OAuth flow:
 * the state_id surviving a login redirect, and Allow never POSTing twice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

const { routerState, useAuthMock } = vi.hoisted(() => ({
  routerState: {
    isReady: true,
    query: {} as Record<string, string>,
    asPath: '/mcp/authorize',
    replace: vi.fn(),
  },
  useAuthMock: vi.fn(),
}));

vi.mock('next/router', () => ({ useRouter: () => routerState }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import McpAuthorizePage from '../../pages/mcp/authorize';

const STATE_ID = 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g';
const AUTHED = { currentUser: { email: 'lew@velocityfibre.co.za' }, isAuthenticated: true, loading: false };

const fetchMock = vi.fn();
const assign = vi.fn();

describe('pages/mcp/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerState.isReady = true;
    routerState.query = { state_id: STATE_ID };
    routerState.asPath = `/mcp/authorize?state_id=${STATE_ID}`;
    useAuthMock.mockReturnValue(AUTHED);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, href: 'https://dev.fibreflow.app/mcp/authorize' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an unauthenticated visitor to sign-in with the state_id preserved in returnUrl', async () => {
    useAuthMock.mockReturnValue({ currentUser: null, isAuthenticated: false, loading: false });
    render(<McpAuthorizePage />);

    await waitFor(() => expect(routerState.replace).toHaveBeenCalled());
    const target = routerState.replace.mock.calls[0][0] as string;
    expect(target).toContain('/sign-in?returnUrl=');

    // The whole point: the state_id must come back after login.
    const returnUrl = decodeURIComponent(target.split('returnUrl=')[1]);
    expect(returnUrl).toBe(`/mcp/authorize?state_id=${STATE_ID}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for the router before deciding, so a not-yet-hydrated query is not read as missing', () => {
    routerState.isReady = false;
    routerState.query = {};
    render(<McpAuthorizePage />);

    expect(screen.getByText(/Loading/i)).toBeTruthy();
    expect(screen.queryByText(/missing its authorization reference/i)).toBeNull();
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it('does not redirect while auth is still resolving', () => {
    useAuthMock.mockReturnValue({ currentUser: null, isAuthenticated: false, loading: true });
    render(<McpAuthorizePage />);
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it('refuses to render a consent prompt when state_id is absent', async () => {
    routerState.query = {};
    routerState.asPath = '/mcp/authorize';
    render(<McpAuthorizePage />);

    await waitFor(() => expect(screen.getByText(/Could not authorize/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Allow$/ })).toBeNull();
  });

  it('shows the signed-in email so the granted identity is unambiguous', async () => {
    render(<McpAuthorizePage />);
    await waitFor(() => expect(screen.getByText('lew@velocityfibre.co.za')).toBeTruthy());
  });

  it('posts the stateId once and follows the service redirect', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=abc' } }),
    });
    render(<McpAuthorizePage />);

    const allow = await screen.findByRole('button', { name: /^Allow$/ });
    fireEvent.click(allow);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=abc'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mcp/consent');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ stateId: STATE_ID });
  });

  it('mints once on a double-click — the second click never reaches the API', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    render(<McpAuthorizePage />);

    const allow = await screen.findByRole('button', { name: /^Allow$/ });

    // Both clicks are dispatched inside ONE act() block, so React does not re-render
    // between them and the button is still enabled for the second. fireEvent.click()
    // twice would NOT test this: each call flushes act(), disabling the button, so the
    // disabled attribute would absorb the second click and the in-flight guard could be
    // deleted without any test failing.
    await act(async () => {
      allow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      allow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true, json: async () => ({ data: { redirectUrl: 'https://claude.ai/cb' } }) });
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });

  it('surfaces the API error and does not navigate when consent fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Authorization could not be completed.' } }),
    });
    render(<McpAuthorizePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Allow$/ }));

    await waitFor(() => expect(screen.getByText(/Authorization could not be completed/i)).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not navigate when the API returns 200 without a redirectUrl', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    render(<McpAuthorizePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Allow$/ }));

    await waitFor(() => expect(screen.getByText(/Could not authorize/i)).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
  });

  it('handles a network failure without navigating', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<McpAuthorizePage />);

    fireEvent.click(await screen.findByRole('button', { name: /^Allow$/ }));

    await waitFor(() => expect(screen.getByText(/offline/i)).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
  });

  it('Cancel mints nothing', async () => {
    render(<McpAuthorizePage />);

    fireEvent.click(await screen.findByRole('button', { name: /Cancel/i }));

    await waitFor(() => expect(screen.getByText(/Authorization cancelled/i)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
