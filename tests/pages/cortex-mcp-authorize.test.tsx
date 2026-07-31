import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/contexts/AuthContext');

import { getServerSideProps } from '../../pages/cortex/mcp/authorize';
import {
  ATTACKER_CONTEXT,
  CALLBACK,
  FAILURE_RESPONSES,
  ROUTE,
  STATE_ID,
  authenticatedLewResponse,
  renderConsentPage,
  resetConsentBrowser,
} from './cortex-mcp-consent-browser';

afterEach(resetConsentBrowser);

describe('Cortex MCP authorization page', () => {
  it('waits for router hydration before evaluating state', async () => {
    const browser = renderConsentPage({
      route: ROUTE,
      routerReady: false,
      authResponse: authenticatedLewResponse,
    });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/missing its authorization reference/i)).not.toBeInTheDocument();
    browser.hydrateRouter();
    expect(await screen.findByRole('button', { name: /^Allow$/ })).toBeEnabled();
  });

  it('waits for real auth hydration before redirecting', async () => {
    const browser = renderConsentPage({ authResponse: { status: 401 }, deferAuth: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(browser.internalPaths).toEqual([]);
    await act(async () => browser.releaseAuth());
    await browser.waitForPath('/sign-in');
  });

  it('preserves state through FibreFlow sign-in', async () => {
    const browser = renderConsentPage({ authResponse: { status: 401 } });
    await browser.waitForPath('/sign-in');
    expect(browser.returnUrl()).toBe(ROUTE);
    expect(browser.recordedRequests('/api/cortex/mcp-consent-context')).toEqual([]);
    expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([]);
  });

  it('fails readably without state and renders no Allow action', async () => {
    renderConsentPage({
      route: '/cortex/mcp/authorize',
      authResponse: authenticatedLewResponse,
    });
    expect(await screen.findByText(/missing its authorization reference/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Allow$/ })).not.toBeInTheDocument();
  });

  it('shows the attacker-provided name and exact redirect before enabling Allow', async () => {
    const browser = renderConsentPage({ authResponse: authenticatedLewResponse });
    expect(await screen.findByText('lew@velocityfibre.co.za')).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: 'Allow Cortex Knowledge access?',
    })).toBeInTheDocument();
    expect(screen.getByText(ATTACKER_CONTEXT.clientName)).toBeInTheDocument();
    expect(screen.getByText(/provided by the connector/i)).toBeInTheDocument();
    const redirect = screen.getByText(ATTACKER_CONTEXT.redirectUri);
    expect(redirect).toBeInTheDocument();
    expect(redirect.closest('a')).toBeNull();
    expect(screen.queryByRole('link', {
      name: ATTACKER_CONTEXT.redirectUri,
    })).not.toBeInTheDocument();
    expect(screen.getByText(/receives the authorization result/i)).toBeInTheDocument();
    expect(screen.getByText('· Read-only Cortex tools')).toBeInTheDocument();
    expect(screen.getByText(/never displays or asks you to paste a bearer token/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Allow$/ })).toBeEnabled();
    expect(browser.recordedRequests('/api/cortex/mcp-consent-context')).toEqual([{
      method: 'POST',
      json: { stateId: STATE_ID },
    }]);
  });

  it('renders an attacker-controlled client name only as text', async () => {
    const payload = '<img data-attacker="true" src=x onerror=alert(1)>';
    renderConsentPage({
      authResponse: authenticatedLewResponse,
      contextResponse: {
        status: 200,
        body: { data: { ...ATTACKER_CONTEXT, clientName: payload } },
      },
    });

    expect(await screen.findByText(payload)).toBeInTheDocument();
    expect(document.querySelector('[data-attacker="true"]')).toBeNull();
  });

  it('renders attacker-controlled redirect and scope values only as non-link text', async () => {
    const redirectUri = 'https://evil.example/<img data-redirect-attacker="true">';
    const scope = '<svg data-scope-attacker="true" onload=alert(1)>';
    renderConsentPage({
      authResponse: authenticatedLewResponse,
      contextResponse: {
        status: 200,
        body: { data: { ...ATTACKER_CONTEXT, redirectUri, scopes: [scope] } },
      },
    });

    const redirect = await screen.findByText(redirectUri);
    expect(redirect.closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: redirectUri })).not.toBeInTheDocument();
    expect(screen.getByText(scope)).toBeInTheDocument();
    expect(document.querySelector('[data-redirect-attacker="true"]')).toBeNull();
    expect(document.querySelector('[data-scope-attacker="true"]')).toBeNull();
  });

  it('never enables state B using context verified for state A', async () => {
    const stateB = 'L9pQM2ynWz4VhJ6Tf8RcK1sXa3DeUo7B';
    const routeB = `/cortex/mcp/authorize?state_id=${stateB}`;
    let releaseStateB: ((response: { status: number; body: unknown }) => void) | null = null;
    const stateBResponse = new Promise<{ status: number; body: unknown }>((resolve) => {
      releaseStateB = resolve;
    });
    const browser = renderConsentPage({
      authResponse: authenticatedLewResponse,
      consentResponse: { status: 200, body: { data: { redirectUrl: CALLBACK } } },
      contextResponses: [
        { status: 200, body: { data: ATTACKER_CONTEXT } },
        stateBResponse,
      ],
    });
    expect(await screen.findByRole('button', { name: /^Allow$/ })).toBeEnabled();

    act(() => browser.changeRoute(routeB));

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Allow$/ })).not.toBeInTheDocument();
    expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([]);

    await act(async () => {
      releaseStateB?.({
        status: 200,
        body: {
          data: {
            ...ATTACKER_CONTEXT,
            redirectUri: 'https://state-b.example/callback',
          },
        },
      });
      await stateBResponse;
    });
    expect(await screen.findByText('https://state-b.example/callback')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Allow$/ }));
    expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([{
      method: 'POST',
      json: { stateId: stateB },
    }]);
    await waitFor(() => expect(browser.externalLocation()).toBe(CALLBACK));
  });

  it.each([
    ['API rejection', { status: 502, body: { error: { message: 'Context refused' } } }],
    ['missing context', { status: 200, body: { data: {} } }],
    ['network failure', new Error('offline')],
  ] as const)('blocks Allow after context %s', async (_case, contextResponse) => {
    const browser = renderConsentPage({
      authResponse: authenticatedLewResponse,
      contextResponse,
    });

    expect(await screen.findByText('Could not authorize')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Allow$/ })).not.toBeInTheDocument();
    expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([]);
  });

  it('makes Cancel terminal without a consent request', async () => {
    const browser = renderConsentPage({ authResponse: authenticatedLewResponse });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Authorization cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Allow$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cortex connections/i })).toHaveAttribute(
      'href',
      '/connections/cortex',
    );
    expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([]);
    expect(browser.externalLocation()).toBeNull();
  });

  it('posts only stateId once and follows the service redirect', async () => {
    const browser = renderConsentPage({
      authResponse: authenticatedLewResponse,
      consentResponse: { status: 200, body: { data: { redirectUrl: CALLBACK } } },
    });
    const allow = await screen.findByRole('button', { name: /^Allow$/ });
    await act(async () => {
      allow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      allow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(browser.recordedRequests('/api/cortex/mcp-consent')).toEqual([{
      method: 'POST',
      json: { stateId: STATE_ID },
    }]);
    await waitFor(() => expect(browser.externalLocation()).toBe(CALLBACK));
  });

  it.each(FAILURE_RESPONSES)('never navigates after %s', async (_case, consentResponse) => {
    const browser = renderConsentPage({
      authResponse: authenticatedLewResponse,
      consentResponse,
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Allow$/ }));
    expect(await screen.findByText('Could not authorize')).toBeInTheDocument();
    expect(browser.externalLocation()).toBeNull();
  });

  it('sets private consent metadata and keeps SSR enabled', async () => {
    renderConsentPage({ authResponse: authenticatedLewResponse });
    expect(await screen.findByText('lew@velocityfibre.co.za')).toBeInTheDocument();
    expect(document.title).toBe('Authorize Cortex Knowledge | FibreFlow');
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
    await expect(getServerSideProps()).resolves.toEqual({ props: {} });
  });
});
