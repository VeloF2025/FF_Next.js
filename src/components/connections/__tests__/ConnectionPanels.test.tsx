/**
 * @vitest-environment jsdom
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CortexConnectionPanel } from '../CortexConnectionPanel';
import { FibreFlowConnectionPanel } from '../FibreFlowConnectionPanel';
import {
  listResponse,
  renderWithNetwork,
  resetNetwork,
} from './connections-network';

afterEach(() => {
  resetNetwork();
});

describe('CortexConnectionPanel', () => {
  it('shows browser consent and no token or local runtime setup', () => {
    render(<CortexConnectionPanel />);

    expect(screen.getByText('Cortex Knowledge')).toBeInTheDocument();
    expect(screen.getByText(
      'https://app.fibreflow.app/api/cortex-remote-mcp/mcp',
    )).toBeInTheDocument();
    expect(screen.getByText(/FibreFlow sign-in and consent/i))
      .toBeInTheDocument();
    expect(screen.queryByLabelText(/Cortex MCP token/i)).toBeNull();
    expect(screen.queryByText(/\/path\/to\/Cortex/i)).toBeNull();
    expect(screen.queryByText(/uv run/i)).toBeNull();
    expect(screen.queryByText(/CORTEX_USER_TOKEN/i)).toBeNull();
  });

  it('describes the read-only Cortex sources', () => {
    render(<CortexConnectionPanel />);

    expect(screen.getByText(/meetings, email, WhatsApp, SharePoint, timelines and cited evidence/i))
      .toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });
});

describe('FibreFlowConnectionPanel', () => {
  it('shows active sessions and keeps manual mint collapsed', async () => {
    const network = renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': listResponse([{
        id: 'session-1',
        label: 'Claude connector',
        createdAt: '2026-07-30T08:00:00.000Z',
        expiresAt: '2026-10-28T08:00:00.000Z',
        lastUsedAt: null,
      }]),
    });

    expect(await screen.findByRole('cell', { name: 'Claude connector' }))
      .toBeInTheDocument();
    expect(screen.getByText(
      'https://app.fibreflow.app/api/ff-remote-mcp/mcp',
    )).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate token' })).toBeNull();
    expect(network.recordedRequests()).toEqual([{
      method: 'GET',
      path: '/api/me/mcp-tokens',
    }]);
  });

  it('reveals manual lifetime, label and mint controls after expanding Advanced', async () => {
    renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': listResponse([]),
    });
    await screen.findByText(/no active read-only sessions/i);

    fireEvent.click(screen.getByText('Advanced'));

    expect(screen.getByLabelText('Token lifetime')).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate token' })).toBeInTheDocument();
  });

  it('reveals a successfully minted token once and preserves the POST contract', async () => {
    const mintedToken = 'ffmcp_one_time_secret';
    const network = renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': [listResponse([]), listResponse([])],
      'POST /api/me/mcp-tokens': {
        status: 200,
        body: {
          data: {
            token: mintedToken,
            expiresAt: '2026-10-28T08:00:00.000Z',
          },
        },
      },
    });
    await screen.findByText(/no active read-only sessions/i);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Claude desktop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    expect(await screen.findByDisplayValue(mintedToken)).toBeInTheDocument();
    expect(screen.getByText(/it will not be shown again/i)).toBeInTheDocument();
    expect(network.recordedRequests()).toContainEqual({
      method: 'POST',
      path: '/api/me/mcp-tokens',
      json: { lifetime: '30d', label: 'Claude desktop' },
    });
  });

  it('revokes an active session through the existing DELETE boundary', async () => {
    const network = renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': [
        listResponse([{
          id: 'session-1',
          label: 'Claude connector',
          createdAt: '2026-07-30T08:00:00.000Z',
          expiresAt: '2026-10-28T08:00:00.000Z',
          lastUsedAt: null,
        }]),
        listResponse([]),
      ],
      'DELETE /api/me/mcp-tokens/session-1': {
        status: 200,
        body: { data: { revoked: true } },
      },
    });
    await screen.findByRole('cell', { name: 'Claude connector' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Claude connector' }))
        .not.toBeInTheDocument();
    });
    expect(network.recordedRequests()).toContainEqual({
      method: 'DELETE',
      path: '/api/me/mcp-tokens/session-1',
    });
  });
});
