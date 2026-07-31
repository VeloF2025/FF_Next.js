/**
 * @vitest-environment jsdom
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/contexts/AuthContext');

import CortexConnectionsPage, {
  getServerSideProps as cortexProps,
} from '../../pages/connections/cortex';
import FibreFlowConnectionsPage, {
  getServerSideProps as fibreflowProps,
} from '../../pages/connections/fibreflow';
import { getServerSideProps } from '../../pages/connections';
import {
  renderConnectionsPage,
  resetConnectionsBrowser,
} from './connections-browser';

afterEach(resetConnectionsBrowser);

describe('Connections pages', () => {
  it('redirects the module root to FibreFlow connections', async () => {
    await expect(getServerSideProps()).resolves.toEqual({
      redirect: {
        destination: '/connections/fibreflow',
        permanent: false,
      },
    });
  });

  /**
   * The flag must be read per request from the right variable. Production runs
   * without FF_MCP_TOKEN_UI_ENABLED, and the sessions UI calls an endpoint that
   * 404s there — reading the wrong name would put the broken panel back.
   */
  describe('server-side feature gates', () => {
    const original = {
      ff: process.env.FF_MCP_TOKEN_UI_ENABLED,
      cortex: process.env.CORTEX_MCP_TOKEN_UI_ENABLED,
    };

    afterEach(() => {
      process.env.FF_MCP_TOKEN_UI_ENABLED = original.ff;
      process.env.CORTEX_MCP_TOKEN_UI_ENABLED = original.cortex;
    });

    it('disables FibreFlow sessions when the flag is unset, as in production', () => {
      delete process.env.FF_MCP_TOKEN_UI_ENABLED;
      expect(fibreflowProps()).toEqual({ props: { sessionsEnabled: false } });
    });

    it.each(['false', 'TRUE ', 'true'])(
      'reads FF_MCP_TOKEN_UI_ENABLED=%s case- and whitespace-insensitively',
      (value) => {
        process.env.FF_MCP_TOKEN_UI_ENABLED = value;
        expect(fibreflowProps()).toEqual({
          props: { sessionsEnabled: value.trim().toLowerCase() === 'true' },
        });
      },
    );

    it('does not let the Cortex flag enable the FibreFlow sessions UI', () => {
      delete process.env.FF_MCP_TOKEN_UI_ENABLED;
      process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
      expect(fibreflowProps()).toEqual({ props: { sessionsEnabled: false } });
    });

    it('gates Cortex revoke on its own flag', () => {
      process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
      expect(cortexProps()).toEqual({ props: { revokeEnabled: true } });
      delete process.env.CORTEX_MCP_TOKEN_UI_ENABLED;
      expect(cortexProps()).toEqual({ props: { revokeEnabled: false } });
    });
  });

  it('renders FibreFlow Operations with one main landmark', async () => {
    renderConnectionsPage(
      <FibreFlowConnectionsPage sessionsEnabled={false} />,
      '/connections/fibreflow',
      false,
    );

    expect(await screen.findByRole('heading', { name: 'FibreFlow Operations' }))
      .toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('redirects a logged-out FibreFlow visitor before rendering connection controls', async () => {
    const browser = renderConnectionsPage(
      <FibreFlowConnectionsPage sessionsEnabled={false} />,
      '/connections/fibreflow',
      false,
      { authenticated: false },
    );

    await waitFor(() => {
      expect(browser.internalPaths).toEqual(['/sign-in']);
      expect(screen.queryByRole('heading', { name: 'FibreFlow Operations' }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Active sessions' }))
        .not.toBeInTheDocument();
      expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    });
  });

  it('shows authorized Cortex content with one main landmark', async () => {
    renderConnectionsPage(
      <CortexConnectionsPage revokeEnabled={false} />,
      '/connections/cortex',
      true,
    );

    expect(await screen.findByRole('heading', { name: 'Cortex Knowledge' }))
      .toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows the real access-denied surface without Cortex content when denied', async () => {
    renderConnectionsPage(
      <CortexConnectionsPage revokeEnabled={false} />,
      '/connections/cortex',
      false,
    );

    expect(await screen.findByRole('heading', { name: 'Access Denied' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cortex Knowledge' }))
      .not.toBeInTheDocument();
  });

  it('redirects a logged-out Cortex visitor to sign-in', async () => {
    const browser = renderConnectionsPage(
      <CortexConnectionsPage revokeEnabled={false} />,
      '/connections/cortex',
      false,
      { authenticated: false },
    );

    // Matches the FibreFlow page: an unauthenticated visitor belongs at
    // sign-in, not on an "Access Denied" card that implies a permission gap.
    await waitFor(() => {
      expect(browser.internalPaths).toEqual(['/sign-in']);
      expect(screen.queryByRole('heading', { name: 'Cortex Knowledge' }))
        .not.toBeInTheDocument();
    });
  });

  it('fails closed when permission lookup fails', async () => {
    renderConnectionsPage(
      <CortexConnectionsPage revokeEnabled={false} />,
      '/connections/cortex',
      false,
      { permissionStatus: 503 },
    );

    expect(await screen.findByRole('heading', { name: 'Access Denied' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cortex Knowledge' }))
      .not.toBeInTheDocument();
  });
});
