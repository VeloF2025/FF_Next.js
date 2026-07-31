import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/contexts/AuthContext');

import { getServerSideProps } from '../../pages/cortex/mcp/authorize';
import {
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

  it('shows the verified identity and read-only Cortex scope', async () => {
    renderConsentPage({ authResponse: authenticatedLewResponse });
    expect(await screen.findByText('lew@velocityfibre.co.za')).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: 'Allow Claude to read Cortex Knowledge as you?',
    })).toBeInTheDocument();
    expect(screen.getByText('· Read-only Cortex tools')).toBeInTheDocument();
    expect(screen.getByText(/never displays or asks you to paste a bearer token/i)).toBeInTheDocument();
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
