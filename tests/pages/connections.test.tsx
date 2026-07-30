/**
 * @vitest-environment jsdom
 */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/contexts/AuthContext');

import CortexConnectionsPage from '../../pages/connections/cortex';
import FibreFlowConnectionsPage from '../../pages/connections/fibreflow';
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

  it('renders FibreFlow Operations with one main landmark', async () => {
    renderConnectionsPage(
      <FibreFlowConnectionsPage />,
      '/connections/fibreflow',
      false,
    );

    expect(await screen.findByRole('heading', { name: 'FibreFlow Operations' }))
      .toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows authorized Cortex content with one main landmark', async () => {
    renderConnectionsPage(
      <CortexConnectionsPage />,
      '/connections/cortex',
      true,
    );

    expect(await screen.findByRole('heading', { name: 'Cortex Knowledge' }))
      .toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows the real access-denied surface without Cortex content when denied', async () => {
    renderConnectionsPage(
      <CortexConnectionsPage />,
      '/connections/cortex',
      false,
    );

    expect(await screen.findByRole('heading', { name: 'Access Denied' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cortex Knowledge' }))
      .not.toBeInTheDocument();
  });

  it('fails closed when the visitor is unauthenticated', async () => {
    renderConnectionsPage(
      <CortexConnectionsPage />,
      '/connections/cortex',
      false,
      { authenticated: false },
    );

    expect(await screen.findByRole('heading', { name: 'Access Denied' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cortex Knowledge' }))
      .not.toBeInTheDocument();
  });

  it('fails closed when permission lookup fails', async () => {
    renderConnectionsPage(
      <CortexConnectionsPage />,
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
