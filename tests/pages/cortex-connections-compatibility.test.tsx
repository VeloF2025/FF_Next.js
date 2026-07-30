/**
 * @vitest-environment jsdom
 */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/contexts/AuthContext');

import CortexPage from '../../pages/cortex';
import {
  renderConnectionsPage,
  resetConnectionsBrowser,
} from './connections-browser';

afterEach(resetConnectionsBrowser);

describe('/cortex FibreFlow compatibility', () => {
  it('keeps the compact legacy panel until Task 7 removes it', async () => {
    renderConnectionsPage(
      <CortexPage mcpEnabled={false} ffMcpEnabled />,
      '/cortex',
      false,
    );

    expect(await screen.findByText('FibreFlow (read-only)'))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'FibreFlow Operations' }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(
      'https://app.fibreflow.app/api/ff-remote-mcp/mcp',
    )).not.toBeInTheDocument();
  });
});
