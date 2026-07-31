/**
 * @vitest-environment jsdom
 */
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/contexts/AuthContext');

import CortexPage from '../../pages/cortex';
import {
  renderConnectionsPage,
  resetConnectionsBrowser,
} from './connections-browser';

afterEach(resetConnectionsBrowser);

describe('/cortex knowledge page', () => {
  it('keeps knowledge features and links authorized reviewers to connections', async () => {
    const LegacyFlaggedPage = CortexPage as React.ComponentType<{
      mcpEnabled?: boolean;
      ffMcpEnabled?: boolean;
    }>;

    renderConnectionsPage(
      <LegacyFlaggedPage mcpEnabled ffMcpEnabled />,
      '/cortex',
      true,
    );

    const main = await screen.findByRole('main');
    expect(within(main).getByRole('heading', { name: 'Cortex' }))
      .toBeInTheDocument();
    expect(within(main).getByRole('textbox', { name: 'Knowledge base query' }))
      .toBeInTheDocument();
    expect(await within(main).findByText('Review queue is empty.'))
      .toBeInTheDocument();
    expect(within(main).queryByText(/Generate token/i)).toBeNull();
    expect(within(main).queryByText(/FibreFlow \(read-only\)/i)).toBeNull();
    expect(await within(main).findByRole('link', { name: /AI Connections/i }))
      .toHaveAttribute('href', '/connections/cortex');
    expect(await screen.findByRole(
      'link',
      { name: 'Cortex' },
      { timeout: 5_000 },
    ))
      .toHaveAttribute('href', '/cortex');
    const sidebarConnections = await screen.findAllByRole(
      'link',
      { name: 'AI Connections' },
      { timeout: 5_000 },
    );
    expect(sidebarConnections).toHaveLength(1);
    expect(sidebarConnections[0]).toHaveAttribute(
      'href',
      '/connections/fibreflow',
    );
  });

  it('hides the connections link from unauthorized users', async () => {
    renderConnectionsPage(<CortexPage />, '/cortex', false);

    const main = await screen.findByRole('main');
    expect(await within(main).findByText('Review queue is empty.'))
      .toBeInTheDocument();
    expect(within(main).queryByRole('link', { name: /AI Connections/i }))
      .toBeNull();
  });
});
